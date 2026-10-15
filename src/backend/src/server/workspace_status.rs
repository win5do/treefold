use super::git_routes::{git_worktrees, normalized_path};
use super::{AppState, AxumPath, Json, Result, State, blocking_git_operation};
use crate::model::GitWorktree;

/// Inspect only this Workspace's checkouts, never its siblings or source checkout.
pub(super) async fn get_worktrees(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Vec<GitWorktree>>> {
    let workspace = state.store.workspace(&id).await?;
    let locations = state.store.workspace_repositories(&id).await?;
    let repositories = state.store.repositories(&workspace.project_id).await?;
    let mut inputs = Vec::new();
    for location in locations {
        if location.git_status == "creating" || location.checkout_path.is_none() {
            continue;
        }
        let Some(repository) = repositories
            .iter()
            .find(|r| r.id == location.project_repository_id)
        else {
            continue;
        };
        let operation = state
            .store
            .latest_parent_operation(&location.id, "integrate")
            .await?;
        inputs.push((location, repository.source_root.clone(), operation));
    }
    blocking_git_operation(move || async move {
        let result = crate::git_parallel::map(&inputs, |(location, source, operation)| {
            let checkout = normalized_path(location.checkout_path.as_deref().unwrap());
            let item = git_worktrees(source)
                .ok()?
                .into_iter()
                .find(|item| normalized_path(&item.path) == checkout)?;
            let target = super::worktree_status::comparison_target(source);
            let mut status = super::worktree_status::inspect_worktree_status(
                source,
                &item,
                target.as_ref(),
                operation.as_slice(),
            );
            status.cleanup_candidate &= workspace.status != "active";
            Some(GitWorktree {
                project_repository_id: location.project_repository_id.clone(),
                repository_name: location.repository_name.clone(),
                path: item.path,
                branch: item.branch,
                head_commit: item.head_commit.chars().take(10).collect(),
                status,
                is_main: item.is_main || normalized_path(source) == checkout,
                workspace_id: (workspace.status == "active").then(|| workspace.id.clone()),
                workspace_name: (workspace.status == "active").then(|| workspace.name.clone()),
            })
        })
        .into_iter()
        .flatten()
        .collect();
        Ok(Json(result))
    })
    .await
}
