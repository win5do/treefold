use super::{
    ApiJson, AppError, AppState, AxumPath, CreateDeliveryPreflight, FinishBatch, FinishBatchItem,
    FinishPlanItem, FinishWorkspace, Json, Result, State, StatusCode, blocking_git_operation,
    blocking_git_operation_for, cleanup_finished_repository,
    create_workspace_repository_preflight_impl, finish_workspace_repository_impl,
    project_worktrees_cache,
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
    if active.contains(&id) || state.store.finish_batch(&id).await?.is_some() {
        return Err(AppError::BadRequest(
            "a Finish operation already exists; reopen it to continue".into(),
        ));
    }
    let check_state = state.clone();
    let check_id = id.clone();
    let batch = blocking_git_operation(move || async move {
        prepare_batch(&check_state, &check_id, request.repositories).await
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

pub(super) async fn prepare_batch(
    state: &AppState,
    id: &str,
    plans: Vec<FinishPlanItem>,
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
        super::delivery::validate_delivery_input(&input(&plan, true))?;
        verify_plan(state, &plan, false).await?;
        let repository = repositories
            .iter()
            .find(|r| r.id == plan.repository_id)
            .unwrap();
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
        workspace_id: id.into(),
        status: "running".into(),
        items,
        error: None,
    })
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
    let _ = super::git_routes::archive_workspace(
        State(state.clone()),
        AxumPath(batch.workspace_id.clone()),
    )
    .await?;
    batch.status = "completed".into();
    batch.error = None;
    state.store.save_finish_batch(&batch).await?;
    let workspace = state.store.workspace(&batch.workspace_id).await?;
    project_worktrees_cache()
        .invalidate(&workspace.project_id)
        .await;
    state.runtime.publish_sessions();
    Ok(())
}

#[cfg(test)]
mod tests;
