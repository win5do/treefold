use super::{
    ApiJson, AppError, AppState, AxumPath, CreateDeliveryPreflight, FinishBatch, FinishBatchItem,
    FinishPlanItem, FinishWorkspace, Json, Result, State, StatusCode, blocking_git_operation,
    blocking_git_operation_for, cleanup_finished_repository,
    create_workspace_repository_preflight_impl, finish_workspace_repository_impl,
};
use serde::Deserialize;
use std::{collections::HashSet, sync::OnceLock};
use tokio::sync::Mutex;

pub(super) fn workers() -> &'static Mutex<HashSet<String>> {
    static WORKERS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    WORKERS.get_or_init(|| Mutex::new(HashSet::new()))
}

#[derive(Deserialize)]
pub(super) struct FinishBatchRequest {
    #[serde(default)]
    pub continue_work: bool,
    pub repositories: Vec<FinishPlanItem>,
}

fn input(item: &FinishPlanItem, cleanup: bool) -> FinishWorkspace {
    FinishWorkspace {
        code_action: item.code_action.clone(),
        todo_action: String::new(),
        push_after_merge: false,
        keep_session_history: true,
        delete_worktree: cleanup && item.delete_worktree,
        delete_branch: cleanup && item.delete_branch,
        commit_message: None,
        preflight_id: Some(item.preflight_id.clone()),
    }
}

pub(super) async fn get_finish_batch(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Option<FinishBatch>>> {
    let mut batch = state.store.finish_batch(&id).await?;
    if let Some(batch) = batch.as_mut() {
        if batch.status == "running" && !workers().lock().await.contains(&id) {
            batch.status = "paused".into();
            batch.error =
                Some("Execution was interrupted. Continue to resume the remaining steps.".into());
        }
    }
    Ok(Json(batch))
}

pub(super) async fn start_finish_batch(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(request): ApiJson<FinishBatchRequest>,
) -> Result<(StatusCode, Json<FinishBatch>)> {
    let mut active = workers().lock().await;
    if active.contains(&id)
        || state
            .store
            .finish_batch(&id)
            .await?
            .is_some_and(|b| !b.continue_work || b.status != "completed")
    {
        return Err(AppError::BadRequest(
            "a Finish operation already exists; reopen it to continue".into(),
        ));
    }
    let check_state = state.clone();
    let check_id = id.clone();
    let batch = blocking_git_operation(move || async move {
        prepare_batch_with_mode(
            &check_state,
            &check_id,
            request.repositories,
            request.continue_work,
        )
        .await
    })
    .await?;
    state.store.save_finish_batch(&batch).await?;
    active.insert(id.clone());
    launch(state, batch.clone(), false);
    Ok((StatusCode::ACCEPTED, Json(batch)))
}

pub(super) async fn resume_finish_batch(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<FinishBatch>> {
    let mut active = workers().lock().await;
    let mut batch = state
        .store
        .finish_batch(&id)
        .await?
        .ok_or(AppError::NotFound)?;
    if active.contains(&id) || batch.status == "completed" {
        return Ok(Json(batch));
    }
    batch.status = "running".into();
    batch.error = None;
    state.store.save_finish_batch(&batch).await?;
    active.insert(id);
    launch(state, batch.clone(), true);
    Ok(Json(batch))
}

#[cfg(test)]
pub(super) async fn prepare_batch(
    state: &AppState,
    id: &str,
    plans: Vec<FinishPlanItem>,
) -> Result<FinishBatch> {
    prepare_batch_with_mode(state, id, plans, false).await
}

pub(super) async fn prepare_batch_with_mode(
    state: &AppState,
    id: &str,
    plans: Vec<FinishPlanItem>,
    continue_work: bool,
) -> Result<FinishBatch> {
    let workspace = state.store.workspace(id).await?;
    if !matches!(workspace.kind.as_str(), "workspace" | "fork")
        || workspace.status != "active"
        || state.store.project(&workspace.project_id).await?.status != "active"
    {
        return Err(AppError::BadRequest(
            "only active Workspaces can be finished".into(),
        ));
    }
    if state
        .store
        .forks(id)
        .await?
        .iter()
        .any(|fork| fork.status == "active")
    {
        return Err(AppError::BadRequest(
            "finish active Forks before their parent Workspace".into(),
        ));
    }
    if continue_work
        && (plans.is_empty()
            || plans.iter().any(|p| {
                !matches!(p.code_action.as_str(), "local_merge" | "push_branch")
                    || (workspace.kind == "fork" && p.code_action == "push_branch")
                    || p.delete_worktree
                    || p.delete_branch
            }))
    {
        return Err(AppError::BadRequest("Intermediate delivery supports ordinary merge or Workspace feature push, retaining all checkouts and branches".into()));
    }
    {
        let mut actions = plans
            .iter()
            .filter(|p| p.code_action != "skip")
            .map(|p| p.code_action.as_str());
        if let Some(first) = actions.next() {
            if actions.any(|action| action != first) {
                return Err(AppError::BadRequest(
                    "Use one delivery strategy for the entire Workspace or Fork".into(),
                ));
            }
        }
    }
    let repositories = state.store.workspace_repositories(id).await?;
    let required: HashSet<_> = repositories
        .iter()
        .filter(|r| {
            r.access_mode == "read_write"
                && matches!(
                    r.delivery_status.as_str(),
                    "active" | "published" | "failed" | "conflicted"
                )
        })
        .map(|r| r.id.as_str())
        .collect();
    let supplied: HashSet<_> = plans.iter().map(|p| p.repository_id.as_str()).collect();
    if required != supplied || supplied.len() != plans.len() {
        return Err(AppError::BadRequest(
            "confirm every unfinished Repository exactly once".into(),
        ));
    }
    let mut items = Vec::new();
    for plan in plans {
        if plan.code_action == "skip" {
            verify_skip(state, &plan.repository_id).await?;
            if plan.delete_worktree || plan.delete_branch {
                return Err(AppError::BadRequest(
                    "Skipped repositories cannot be cleaned up".into(),
                ));
            }
        } else {
            super::delivery::validate_delivery_input(&input(&plan, true))?;
            verify_plan(state, &plan, false).await?;
        }
        let repository = repositories
            .iter()
            .find(|r| r.id == plan.repository_id)
            .unwrap();
        super::delivery::ensure_worktree_cleanup_owned(
            repository,
            plan.delete_worktree,
            plan.delete_branch,
        )?;
        items.push(FinishBatchItem {
            plan,
            repository_name: repository.repository_name.clone(),
            status: "pending".into(),
            delivered: false,
            cleaned: false,
            error: None,
            error_code: None,
            operation_id: None,
        });
    }
    Ok(FinishBatch {
        continue_work,
        workspace_id: id.into(),
        status: "running".into(),
        items,
        error: None,
    })
}

// A forced plan may skip only a structurally unavailable source, never a dirty
// worktree, merge conflict, unavailable parent, or network failure.
async fn verify_skip(state: &AppState, id: &str) -> Result<()> {
    let repository = state.store.workspace_repository(id).await?;
    match super::workspace_repository_git_path(&repository) {
        Err(AppError::Api {
            code: "WORKTREE_DIRECTORY_MISSING" | "WORKTREE_NOT_GIT" | "WORKTREE_GIT_BROKEN",
            ..
        }) => {}
        Err(error) => return Err(error),
        Ok(_) => {
            return Err(AppError::api(
                StatusCode::CONFLICT,
                "FORCE_SKIP_NOT_AVAILABLE",
                "This repository is available again. Repair or recheck the plan instead of skipping it.",
            ));
        }
    }
    super::finish_recovery::ensure_stopped(state, &repository.workspace_id).await
}

#[derive(Deserialize)]
pub(super) struct SkipRepositories {
    pub repository_ids: Vec<String>,
}

pub(super) async fn force_resume_finish_batch(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(request): ApiJson<SkipRepositories>,
) -> Result<Json<FinishBatch>> {
    let mut active = workers().lock().await;
    if active.contains(&id) {
        return Err(AppError::BadRequest("Finish is still running".into()));
    }
    let mut batch = state
        .store
        .finish_batch(&id)
        .await?
        .ok_or(AppError::NotFound)?;
    if batch.continue_work || batch.status == "completed" || request.repository_ids.is_empty() {
        return Err(AppError::BadRequest(
            "No paused repositories to skip".into(),
        ));
    }
    let check_state = state.clone();
    batch = blocking_git_operation(move || async move {
        let mut seen = HashSet::new();
        for repository_id in request.repository_ids {
            if !seen.insert(repository_id.clone()) {
                return Err(AppError::BadRequest("Duplicate repository".into()));
            }
            let item = batch
                .items
                .iter_mut()
                .find(|item| item.plan.repository_id == repository_id && !item.cleaned)
                .ok_or_else(|| {
                    AppError::BadRequest("Repository is not an unfinished batch item".into())
                })?;
            verify_skip(&check_state, &repository_id).await?;
            item.plan.code_action = "skip".into();
            item.plan.delete_worktree = false;
            item.plan.delete_branch = false;
            item.status = "pending".into();
            item.error = None;
            item.error_code = None;
        }
        Ok(batch)
    })
    .await?;
    batch.status = "running".into();
    batch.error = None;
    state.store.save_finish_batch(&batch).await?;
    active.insert(id);
    launch(state, batch.clone(), true);
    Ok(Json(batch))
}

// A retry may accept a moved target after conflict resolution, but never silently
// deliver new source commits that were not part of the confirmed batch.
async fn verify_plan(state: &AppState, plan: &FinishPlanItem, retry: bool) -> Result<String> {
    let old = state.store.delivery_preflight(&plan.preflight_id).await?;
    if old.workspace_repository_id != plan.repository_id
        || old.code_action != plan.code_action
        || !old.blockers.is_empty()
    {
        return Err(AppError::BadRequest(
            "preflight does not match the confirmed plan".into(),
        ));
    }
    let (_, Json(fresh)) = create_workspace_repository_preflight_impl(
        state.clone(),
        plan.repository_id.clone(),
        CreateDeliveryPreflight {
            code_action: plan.code_action.clone(),
        },
    )
    .await?;
    if old.source_head != fresh.source_head
        || old.source_status != fresh.source_status
        || old.target_branch != fresh.target_branch
        || (!retry && old.target_head != fresh.target_head)
    {
        return Err(AppError::BadRequest("confirmed Git state changed; restore the confirmed source or review the plan before executing".into()));
    }
    if !fresh.blockers.is_empty() {
        return Err(AppError::BadRequest(fresh.blockers.join("; ")));
    }
    Ok(fresh.id)
}

fn launch(state: AppState, batch: FinishBatch, retry: bool) {
    tokio::spawn(async move {
        let id = batch.workspace_id.clone();
        let task_state = state.clone();
        let result = run_batch(&task_state, batch, retry).await;
        if let Err(error) = result {
            if let Ok(Some(mut saved)) = state.store.finish_batch(&id).await {
                saved.status = "paused".into();
                saved.error = Some(error.to_string());
                let _ = state.store.save_finish_batch(&saved).await;
            }
        }
        workers().lock().await.remove(&id);
        state.runtime.publish_sessions();
    });
}

pub(super) async fn run_batch(state: &AppState, mut batch: FinishBatch, retry: bool) -> Result<()> {
    for cleanup in [false, true] {
        if cleanup && batch.continue_work {
            break;
        }
        if cleanup
            && state
                .store
                .forks(&batch.workspace_id)
                .await?
                .iter()
                .any(|fork| fork.status == "active")
        {
            return Err(AppError::BadRequest(
                "finish active Forks before cleaning up their parent Workspace".into(),
            ));
        }
        for index in 0..batch.items.len() {
            if batch.items[index].plan.code_action == "skip" {
                if !batch.items[index].cleaned {
                    let _gate = super::finish_recovery::mutation_gate().write().await;
                    let repository_id = batch.items[index].plan.repository_id.clone();
                    let check_state = state.clone();
                    let result = blocking_git_operation(move || async move {
                        // The skip was explicitly authorized while unavailable. A retry
                        // keeps that decision and never touches the repository's files.
                        let owner = check_state
                            .store
                            .workspace_repository(&repository_id)
                            .await?
                            .workspace_id;
                        super::finish_recovery::ensure_stopped(&check_state, &owner).await?;
                        let repository = check_state
                            .store
                            .workspace_repository(&repository_id)
                            .await?;
                        // Preserve a recorded successful delivery if only cleanup is skipped.
                        if !matches!(
                            repository.delivery_status.as_str(),
                            "delivered" | "pushed" | "kept"
                        ) {
                            check_state
                                .store
                                .finish_workspace_repository(
                                    &repository_id,
                                    "discarded",
                                    "skipped",
                                    None,
                                    &crate::store::now(),
                                )
                                .await?;
                        }
                        Ok(())
                    })
                    .await;
                    let item = &mut batch.items[index];
                    if let Err(error) = result {
                        item.status = "blocked".into();
                        item.error = Some(error.to_string());
                        item.error_code = match error {
                            AppError::Api { code, .. } => Some(code.into()),
                            _ => None,
                        };
                        batch.status = "paused".into();
                        state.store.save_finish_batch(&batch).await?;
                        state.runtime.publish_sessions();
                        return Ok(());
                    }
                    item.cleaned = true;
                    item.status = "skipped".into();
                    item.operation_id = None;
                    item.error = None;
                    item.error_code = None;
                    state.store.save_finish_batch(&batch).await?;
                }
                continue;
            }
            if if cleanup {
                batch.items[index].cleaned
            } else {
                batch.items[index].delivered
            } {
                continue;
            }
            batch.items[index].status = if cleanup { "cleaning" } else { "delivering" }.into();
            batch.items[index].error = None;
            batch.items[index].error_code = None;
            state.store.save_finish_batch(&batch).await?;
            state.runtime.publish_sessions();
            let plan = batch.items[index].plan.clone();
            let task_state = state.clone();
            let continue_work = batch.continue_work;
            let common = state
                .store
                .workspace_repository(&plan.repository_id)
                .await?
                .project_repository_id;
            let common = state.store.repository(&common).await?.git_common_dir;
            let result = blocking_git_operation_for(common, move || async move {
                let repository = task_state
                    .store
                    .workspace_repository(&plan.repository_id)
                    .await?;
                if cleanup {
                    let workspace = task_state.store.workspace(&repository.workspace_id).await?;
                    let snapshot = task_state
                        .store
                        .delivery_preflight(&plan.preflight_id)
                        .await?;
                    cleanup_finished_repository(
                        &task_state,
                        &workspace,
                        &repository,
                        &input(&plan, true),
                        repository
                            .checkout_path
                            .as_deref()
                            .ok_or_else(|| AppError::BadRequest("missing worktree path".into()))?,
                        repository.branch.as_deref().unwrap_or(""),
                        &snapshot.source_head,
                    )
                    .await?;
                    return Ok(None);
                }
                if continue_work {
                    return intermediate::deliver(&task_state, &plan, retry).await;
                }
                let mut execution = input(&plan, false);
                if matches!(
                    repository.delivery_status.as_str(),
                    "active" | "failed" | "conflicted" | "published"
                ) {
                    if let Some(operation) = task_state
                        .store
                        .latest_parent_operation(&repository.id, "integrate")
                        .await?
                    {
                        let operation = super::parent_operation::reconcile_parent_operation(
                            &task_state,
                            &operation,
                        )
                        .await?;
                        if matches!(
                            operation.status.as_str(),
                            "active" | "conflicted" | "resolving" | "recovery_required"
                        ) {
                            return Ok(Some(operation.id));
                        }
                    }
                    execution.preflight_id = Some(verify_plan(&task_state, &plan, retry).await?);
                }
                let Json(progress) =
                    finish_workspace_repository_impl(task_state, plan.repository_id, execution)
                        .await?;
                if progress.status == "paused" {
                    return Ok(progress.operation.map(|o| o.id));
                }
                Ok(None)
            })
            .await;
            match result {
                Ok(None) => {
                    let item = &mut batch.items[index];
                    if cleanup {
                        item.cleaned = true;
                        item.status = "completed".into();
                    } else {
                        item.delivered = true;
                        item.status = "delivered".into();
                    }
                    item.operation_id = None;
                }
                result => {
                    let item = &mut batch.items[index];
                    item.status = "blocked".into();
                    match result {
                        Ok(operation) => item.operation_id = operation,
                        Err(error) => {
                            if let AppError::Api { code, .. } = &error {
                                item.error_code = Some((*code).into());
                            }
                            item.error = Some(error.to_string());
                        }
                    }
                    batch.status = "paused".into();
                    state.store.save_finish_batch(&batch).await?;
                    state.runtime.publish_sessions();
                    return Ok(());
                }
            }
            state.store.save_finish_batch(&batch).await?;
        }
    }
    if batch.continue_work {
        batch.status = "completed".into();
        batch.error = None;
        for item in &mut batch.items {
            item.cleaned = true;
            item.status = "completed".into();
        }
        state.store.complete_intermediate_batch(&batch).await?;
        state.runtime.publish_sessions();
        return Ok(());
    }
    let _ = super::git_routes::archive_workspace(
        State(state.clone()),
        AxumPath(batch.workspace_id.clone()),
    )
    .await?;
    batch.status = "completed".into();
    batch.error = None;
    state.store.save_finish_batch(&batch).await?;
    state.runtime.publish_sessions();
    Ok(())
}

mod intermediate;

#[cfg(test)]
mod tests;
