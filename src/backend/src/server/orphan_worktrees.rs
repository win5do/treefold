//! Only Project-scoped cleanup can attribute unowned worktrees to repositories.
use super::delivery::{git_head, git_is_ancestor, remove_worktree_if_present};
use super::git_routes::{git_worktrees, normalized_path};
use super::{AppError, AppState, Result, blocking_git_operation_for};
use crate::model::ProjectRepository;
use std::path::{Path, PathBuf};

#[derive(Clone)]
pub(super) struct Orphan {
    pub repository: ProjectRepository,
    pub path: String,
}

async fn owned_paths(state: &AppState, repository: &ProjectRepository) -> Result<Vec<PathBuf>> {
    let mut paths = vec![normalized_path(&repository.source_root)];
    // The same Git repository can be attached to multiple Projects. Any retained
    // record protects its checkout, including archived records in another Project.
    for project in state.store.projects().await? {
        for repository in state.store.repositories(&project.id).await? {
            paths.push(normalized_path(&repository.source_root));
        }
        for workspace in state.store.workspaces(&project.id).await? {
            if !workspace.checkout_path.is_empty() {
                paths.push(normalized_path(&workspace.checkout_path));
            }
            for location in state.store.workspace_repositories(&workspace.id).await? {
                if let Some(path) = location.checkout_path {
                    paths.push(normalized_path(&path));
                }
            }
        }
    }
    Ok(paths)
}

fn managed(state: &AppState, path: &str) -> bool {
    let root = normalized_path(
        state
            .settings
            .treefold_home()
            .join("git/w")
            .to_string_lossy()
            .as_ref(),
    );
    let path = normalized_path(path);
    path != root && Path::new(&path).starts_with(&root)
}

pub(super) async fn discover(state: &AppState, project_id: &str) -> Result<Vec<Orphan>> {
    let mut orphans = Vec::new();
    for repository in state.store.repositories(project_id).await? {
        let state = state.clone();
        let found =
            blocking_git_operation_for(repository.git_common_dir.clone(), move || async move {
                let owned = owned_paths(&state, &repository).await?;
                Ok(git_worktrees(&repository.source_root)?
                    .into_iter()
                    .filter(|item| {
                        !item.is_main
                            && managed(&state, &item.path)
                            && !owned.contains(&normalized_path(&item.path))
                    })
                    .map(|item| Orphan {
                        repository: repository.clone(),
                        path: item.path,
                    })
                    .collect::<Vec<_>>())
            })
            .await?;
        orphans.extend(found);
    }
    Ok(orphans)
}

pub(super) async fn remove(state: &AppState, orphan: Orphan) -> Result<()> {
    let state = state.clone();
    blocking_git_operation_for(
        orphan.repository.git_common_dir.clone(),
        move || async move {
            // Import uses this same repository lock. Recheck ownership immediately before removal.
            let owned = owned_paths(&state, &orphan.repository).await?;
            if !managed(&state, &orphan.path) || owned.contains(&normalized_path(&orphan.path)) {
                return Err(AppError::BadRequest(
                    "Worktree is now owned by a Workspace; kept it".into(),
                ));
            }
            let source = &orphan.repository.source_root;
            let Some(item) = git_worktrees(source)?
                .into_iter()
                .find(|item| normalized_path(&item.path) == normalized_path(&orphan.path))
            else {
                return Ok(());
            };
            if item.is_main || item.locked_reason.is_some() {
                return Err(AppError::BadRequest(
                    "Worktree is a main checkout or locked; kept it".into(),
                ));
            }
            let target = git_head(source)?;
            if !git_is_ancestor(source, &item.head_commit, &target)? {
                return Err(AppError::api(
                    super::StatusCode::CONFLICT,
                    "WORKSPACE_DELETE_UNDELIVERED",
                    "Orphan worktree contains unmerged commits; kept it",
                ));
            }
            if Path::new(&item.path).exists() {
                let status = super::worktree_status::inspect_worktree_status(
                    source,
                    &item,
                    super::worktree_status::comparison_target(source).as_ref(),
                    &[],
                );
                if !status.cleanup_candidate {
                    return Err(AppError::BadRequest(
                        "Orphan worktree is not safe to remove; kept its files and branch".into(),
                    ));
                }
            }
            // Without an ownership record, never infer ownership of the branch itself.
            remove_worktree_if_present(source, &item.path, false)
        },
    )
    .await
}
