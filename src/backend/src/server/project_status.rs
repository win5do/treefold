use super::git_routes::{blocking_git_operation, project_worktrees};
use super::{AppState, AxumPath, Json, Result, State};
use crate::model::{GitWorktree, ProjectRepository};

pub(super) async fn get_worktrees(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Vec<GitWorktree>>> {
    state.store.project(&id).await?;
    Ok(Json(load_worktrees(&state, &id).await?))
}

pub(super) async fn get_repository_worktrees(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Vec<GitWorktree>>> {
    let repository = state.store.repository(&id).await?;
    Ok(Json(
        load_location_worktrees(&state, &repository.project_id, vec![repository.clone()]).await?,
    ))
}

pub(super) async fn load_worktrees(state: &AppState, id: &str) -> Result<Vec<GitWorktree>> {
    let locations = state.store.repositories(id).await?;
    load_location_worktrees(state, id, locations).await
}

async fn load_location_worktrees(
    state: &AppState,
    id: &str,
    locations: Vec<ProjectRepository>,
) -> Result<Vec<GitWorktree>> {
    let tracked_workspaces = state.store.workspaces(id).await?;
    let mut tracked_workspace_repositories = Vec::new();
    for workspace in &tracked_workspaces {
        tracked_workspace_repositories
            .extend(state.store.workspace_repositories(&workspace.id).await?);
    }
    tracked_workspace_repositories.retain(|repository| {
        locations
            .iter()
            .any(|location| location.id == repository.project_repository_id)
    });
    let mut squash_operations = Vec::new();
    for repository in &tracked_workspace_repositories {
        if let Some(operation) = state
            .store
            .latest_parent_operation(&repository.id, "integrate")
            .await?
            && operation.strategy == "squash"
            && operation.status == "completed"
        {
            squash_operations.push(operation);
        }
    }
    blocking_git_operation(move || async move {
        Ok(project_worktrees(
            &locations,
            &tracked_workspaces,
            &tracked_workspace_repositories,
            &squash_operations,
        ))
    })
    .await
}
