//! Message-only HEAD editing. Remote publication checks use local refs only.
use super::{
    ApiJson, AppError, AppState, AxumPath, Json, Result, State, StatusCode,
    blocking_git_operation_for, ensure_repository_ready, git_history, normalized_path,
    workspace_repository_git_path,
};
use crate::model::{RewordRequest, RewordResponse};
mod service;
#[cfg(test)]
mod tests;

fn denied(code: &'static str, message: &str) -> AppError {
    AppError::api(StatusCode::CONFLICT, code, message)
}

pub(super) async fn project(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<RewordRequest>,
) -> Result<Json<RewordResponse>> {
    run(state, id, false, input).await
}
pub(super) async fn workspace(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<RewordRequest>,
) -> Result<Json<RewordResponse>> {
    run(state, id, true, input).await
}

async fn run(
    state: AppState,
    id: String,
    managed: bool,
    input: RewordRequest,
) -> Result<Json<RewordResponse>> {
    let repository_id = if managed {
        state
            .store
            .workspace_repository(&id)
            .await?
            .project_repository_id
    } else {
        id.clone()
    };
    let repository = state.store.repository(&repository_id).await?;
    ensure_repository_ready(&repository)?;
    let common = repository.git_common_dir.clone();
    blocking_git_operation_for(common, move || async move {
        if state.store.project(&repository.project_id).await?.status != "active" {
            return Err(denied(
                "REWORD_OWNERSHIP",
                "Repository is not active and writable",
            ));
        }
        let locations = state
            .store
            .workspace_repositories_for_project_repository(&repository_id)
            .await?;
        let location = if managed {
            Some(state.store.workspace_repository(&id).await?)
        } else {
            locations
                .iter()
                .find(|item| {
                    item.branch_ownership == "managed"
                        && item.checkout_path.as_deref().is_some_and(|p| {
                            normalized_path(p) == normalized_path(&repository.source_root)
                        })
                })
                .cloned()
        };
        let path = if let Some(location) = &location {
            workspace_repository_git_path(location)?.to_owned()
        } else {
            repository.source_root.clone()
        };
        if let Some(location) = &location {
            let workspace = state.store.workspace(&location.workspace_id).await?;
            if workspace.status != "active"
                || !matches!(location.delivery_status.as_str(), "active" | "published")
                || state
                    .store
                    .finish_batch(&workspace.id)
                    .await?
                    .is_some_and(|batch| !batch.continue_work || batch.status != "completed")
            {
                return Err(denied(
                    "REWORD_OWNERSHIP",
                    "Repository has a delivery in progress or is already closed",
                ));
            }
            if workspace.kind != "base"
                && service::output(&path, &["branch", "--show-current"])?
                    != location.branch.as_deref().unwrap_or("")
            {
                return Err(denied(
                    "REWORD_STALE",
                    "Repository branch changed; reopen the editor",
                ));
            }
        }
        let expected = match &input {
            RewordRequest::Preview { expected_head }
            | RewordRequest::Apply { expected_head, .. } => expected_head,
        };
        // Delivery journals retain exact hashes. Do not silently invalidate recovery or cleanup.
        for location in &locations {
            for direction in ["integrate", "update"] {
                if let Some(operation) = state
                    .store
                    .latest_parent_operation(&location.id, direction)
                    .await?
                {
                    let source = normalized_path(&operation.source_path) == normalized_path(&path);
                    let target = normalized_path(&operation.target_path) == normalized_path(&path);
                    if (source || target)
                        && matches!(
                            operation.status.as_str(),
                            "active" | "conflicted" | "resolving" | "recovery_required"
                        )
                    {
                        return Err(denied(
                            "REWORD_OPERATION",
                            "Finish the active Treefold operation first",
                        ));
                    }
                    if operation.status == "completed"
                        && ((source && operation.source_head == *expected)
                            || (target && operation.result_head.as_ref() == Some(expected)))
                    {
                        return Err(denied(
                            "REWORD_DELIVERY",
                            "This commit is referenced by a Treefold delivery record",
                        ));
                    }
                }
            }
        }
        let preview = service::preview(&path, expected)?;
        match input {
            RewordRequest::Preview { .. } => Ok(Json(RewordResponse {
                preview: Some(preview),
                history: None,
            })),
            RewordRequest::Apply {
                expected_head,
                expected_branch,
                message,
                confirmed_refs,
            } => {
                if preview.branch != expected_branch {
                    return Err(denied(
                        "REWORD_STALE",
                        "Repository branch changed; reopen the editor",
                    ));
                }
                if preview
                    .shared_refs
                    .iter()
                    .any(|reference| !confirmed_refs.contains(reference))
                {
                    return Ok(Json(RewordResponse {
                        preview: Some(preview),
                        history: None,
                    }));
                }
                service::apply(
                    &path,
                    &expected_head,
                    &expected_branch,
                    &message,
                    &confirmed_refs,
                )?;
                Ok(Json(RewordResponse {
                    preview: None,
                    history: Some(git_history(&path)?),
                }))
            }
        }
    })
    .await
}
