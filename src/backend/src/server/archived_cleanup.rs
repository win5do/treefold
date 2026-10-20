use super::{AppError, AppState, AxumPath, Result, State, StatusCode};
use crate::model::{ArchivedCleanupResult, ArchivedCleanupSkipped, ArchivedCleanupTask, Workspace};
use axum::Json;
use std::{collections::HashMap, sync::Arc};
use tokio::sync::Mutex;

/// Latest task per scope, owned by this backend instance. No persisted task state.
#[derive(Clone, Default)]
pub struct CleanupTasks(Arc<Mutex<HashMap<String, ArchivedCleanupTask>>>);

pub(super) async fn list(State(state): State<AppState>) -> Json<Vec<ArchivedCleanupTask>> {
    Json(
        state
            .cleanup_tasks
            .0
            .lock()
            .await
            .values()
            .cloned()
            .collect(),
    )
}

pub(super) async fn project(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<(StatusCode, Json<ArchivedCleanupTask>)> {
    let name = state.store.project(&id).await?.name;
    start(state, "project", id, name).await
}

pub(super) async fn workspace(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<(StatusCode, Json<ArchivedCleanupTask>)> {
    let workspace = state.store.workspace(&id).await?;
    if workspace.kind != "workspace" {
        return Err(AppError::BadRequest("Only a Workspace owns Forks".into()));
    }
    start(state, "workspace", id, workspace.name).await
}

async fn start(
    state: AppState,
    scope: &str,
    id: String,
    name: String,
) -> Result<(StatusCode, Json<ArchivedCleanupTask>)> {
    let key = format!("{scope}:{id}");
    let mut tasks = state.cleanup_tasks.0.lock().await;
    if let Some(task) = tasks.get(&key).filter(|task| task.status == "running") {
        return Ok((StatusCode::ACCEPTED, Json(task.clone())));
    }
    let task = ArchivedCleanupTask {
        id: crate::ids::new_id(),
        scope: scope.into(),
        scope_id: id,
        scope_name: name,
        status: "running".into(),
        total: 0,
        completed: 0,
        error: None,
        result: ArchivedCleanupResult::default(),
    };
    tasks.insert(key.clone(), task.clone());
    drop(tasks);
    let mut running = task.clone();
    crate::request_context::spawn(async move {
        let result = run(&state, &key, &mut running).await;
        running.status = if result.is_ok() {
            "completed"
        } else {
            "failed"
        }
        .into();
        running.error = result.err().map(|error| error.to_string());
        update(&state, &key, &running).await;
    });
    Ok((StatusCode::ACCEPTED, Json(task)))
}

async fn update(state: &AppState, key: &str, task: &ArchivedCleanupTask) {
    state
        .cleanup_tasks
        .0
        .lock()
        .await
        .insert(key.to_owned(), task.clone());
    state.runtime.publish_sessions();
}

async fn targets(state: &AppState, task: &ArchivedCleanupTask) -> Result<Vec<Workspace>> {
    if task.scope == "workspace" {
        return Ok(state
            .store
            .forks(&task.scope_id)
            .await?
            .into_iter()
            .filter(|w| w.status == "archived")
            .collect());
    }
    let mut targets = Vec::new();
    for workspace in state
        .store
        .workspaces(&task.scope_id)
        .await?
        .into_iter()
        .filter(|w| {
            w.kind == "workspace" && w.parent_workspace_id.is_none() && w.status == "archived"
        })
    {
        targets.extend(
            state
                .store
                .forks(&workspace.id)
                .await?
                .into_iter()
                .filter(|w| w.status == "archived"),
        );
        targets.push(workspace);
    }
    Ok(targets)
}

fn skipped(id: String, name: String, error: AppError) -> ArchivedCleanupSkipped {
    let reason = match &error {
        AppError::Api {
            code: "WORKSPACE_DELETE_UNDELIVERED",
            ..
        } => "unmerged",
        AppError::Api {
            code: "WORKSPACE_DELETE_CHANGED",
            ..
        } => "changed",
        AppError::Api {
            code: "FINISH_SESSION_ACTIVE",
            ..
        } => "session_active",
        _ => "cleanup_blocked",
    };
    ArchivedCleanupSkipped {
        id,
        name,
        reason: reason.into(),
        message: error.to_string(),
    }
}

async fn run(state: &AppState, key: &str, task: &mut ArchivedCleanupTask) -> Result<()> {
    let targets = targets(state, task).await?;
    task.total = targets.len();
    update(state, key, task).await;
    let options = super::workspace_delete::DeleteWorkspaceOptions {
        delete_worktrees: true,
        delete_branches: true,
        discard_token: None,
    };
    for target in targets {
        let result = async {
            let _lifecycle = super::workspace_lifecycle::lock(state, &target.id).await?;
            super::workspace_lifecycle::ensure_idle(state, &target.id).await?;
            super::workspace_delete::delete_workspace_locked(state, &target.id, &options, true)
                .await
        }
        .await;
        match result {
            Ok(()) => task.result.deleted_ids.push(target.id),
            Err(AppError::NotFound) => {} // Another scoped cleanup already removed it.
            Err(error) => task
                .result
                .skipped
                .push(skipped(target.id, target.name, error)),
        }
        task.completed += 1;
        update(state, key, task).await;
    }
    if task.scope == "project" {
        let orphans = super::orphan_worktrees::discover(state, &task.scope_id).await?;
        task.total += orphans.len();
        update(state, key, task).await;
        for orphan in orphans {
            let path = orphan.path.clone();
            match super::orphan_worktrees::remove(state, orphan).await {
                Ok(()) => task.result.orphan_paths.push(path),
                Err(error) => task.result.skipped.push(skipped(path.clone(), path, error)),
            }
            task.completed += 1;
            update(state, key, task).await;
        }
    }
    Ok(())
}

#[cfg(test)]
pub(super) async fn wait(state: &AppState, id: &str) -> ArchivedCleanupResult {
    tokio::time::timeout(std::time::Duration::from_secs(20), async {
        loop {
            if let Some(task) = state
                .cleanup_tasks
                .0
                .lock()
                .await
                .values()
                .find(|task| task.id == id)
                .cloned()
                && task.status != "running"
            {
                assert_eq!(task.status, "completed", "{:?}", task.error);
                return task.result;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("cleanup finished")
}
