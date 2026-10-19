use super::{AppError, AppState, AxumPath, Result, State};
use crate::model::{ArchivedCleanupResult, ArchivedCleanupSkipped, Workspace};
use axum::Json;

pub(super) async fn project(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<ArchivedCleanupResult>> {
    let _workers = super::finish_batch::workers().lock().await;
    state.store.project(&id).await?;
    let targets = state
        .store
        .workspaces(&id)
        .await?
        .into_iter()
        .filter(|w| w.kind == "workspace" && w.parent_workspace_id.is_none())
        .collect();
    Ok(Json(cleanup(&state, targets).await))
}

pub(super) async fn workspace(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<ArchivedCleanupResult>> {
    let _workers = super::finish_batch::workers().lock().await;
    if state.store.workspace(&id).await?.kind != "workspace" {
        return Err(AppError::BadRequest("Only a Workspace owns Forks".into()));
    }
    Ok(Json(cleanup(&state, state.store.forks(&id).await?).await))
}

async fn cleanup(state: &AppState, targets: Vec<Workspace>) -> ArchivedCleanupResult {
    let mut result = ArchivedCleanupResult::default();
    let options = super::workspace_delete::DeleteWorkspaceOptions {
        delete_worktrees: true,
        delete_branches: true,
        discard_token: None,
    };
    for target in targets.into_iter().filter(|w| w.status == "archived") {
        match super::workspace_delete::delete_workspace_locked(state, &target.id, &options, true)
            .await
        {
            Ok(()) => result.deleted_ids.push(target.id),
            Err(error) => {
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
                result.skipped.push(ArchivedCleanupSkipped {
                    id: target.id,
                    name: target.name,
                    reason: reason.into(),
                    message: error.to_string(),
                });
            }
        }
    }
    result
}
