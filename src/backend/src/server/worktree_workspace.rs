use axum::{Json, extract::State};
use serde::Deserialize;

use super::{
    ApiJson, AppState, AxumPath, blocking_git_operation_for,
    delivery::git_head,
    git_routes::{git_worktrees, normalized_path},
    workspace::{
        CreateWorkspace, CreatedWorkspace, ExistingWorkspaceWorktree,
        create_workspace_with_existing_worktree, spawn_workspace_setup_shells,
    },
};
use crate::{
    error::{AppError, Result},
    model::Workspace,
};

#[derive(Deserialize)]
pub(super) struct OpenWorktreeWorkspace {
    path: String,
}

pub(super) async fn open_worktree_workspace(
    State(state): State<AppState>,
    AxumPath(repository_id): AxumPath<String>,
    ApiJson(input): ApiJson<OpenWorktreeWorkspace>,
) -> Result<Json<Workspace>> {
    let created = open_worktree_workspace_impl(state.clone(), repository_id, input.path).await?;
    spawn_workspace_setup_shells(
        state.clone(),
        created.workspace.clone(),
        created.setup_shells,
    )
    .await;
    state.runtime.publish_sessions();
    Ok(Json(state.store.workspace(&created.workspace.id).await?))
}

async fn open_worktree_workspace_impl(
    state: AppState,
    repository_id: String,
    path: String,
) -> Result<CreatedWorkspace> {
    // Serialize with Finish/reopen so a checkout cannot change owners mid-import.
    let _workers = super::finish_batch::workers().lock().await;
    let repository = state.store.repository(&repository_id).await?;
    let operation_state = state.clone();
    let created =
        blocking_git_operation_for(repository.git_common_dir.clone(), move || async move {
            let state = operation_state;
            let path = normalized_path(&path);
            let worktree = git_worktrees(&repository.source_root)?
                .into_iter()
                .find(|item| normalized_path(&item.path) == path)
                .ok_or_else(|| {
                    AppError::BadRequest("worktree was not found in this Repository".into())
                })?;
            let mut workspaces = state.store.workspaces(&repository.project_id).await?;
            workspaces.sort_by_key(|workspace| workspace.status != "active");
            for workspace in workspaces {
                if workspace.kind == "base" {
                    continue;
                }
                if state
                    .store
                    .workspace_repositories(&workspace.id)
                    .await?
                    .iter()
                    .any(|item| {
                        item.project_repository_id == repository_id
                            && item
                                .checkout_path
                                .as_deref()
                                .is_some_and(|value| normalized_path(value) == path)
                    })
                {
                    return Ok(CreatedWorkspace {
                        workspace,
                        setup_shells: vec![],
                    });
                }
            }
            if worktree.is_main || path == normalized_path(&repository.source_root) {
                return Err(AppError::BadRequest(
                    "cannot create a Workspace from a main checkout; use a separate worktree".into(),
                ));
            }
            if worktree.branch.is_empty() || worktree.branch == "detached HEAD" {
                return Err(AppError::BadRequest(
                    "check out a local branch before creating a Workspace from this worktree"
                        .into(),
                ));
            }
            let input = CreateWorkspace {
                branch: Some(worktree.branch.clone()),
                description: None,
                repository_remotes: None,
                expected_base_branches: None,
                remote_name: None,
                remote_branch: None,
                generated_branch: None,
            };
            let branch = worktree.branch.clone();
            let selected_repository_id = repository_id.clone();
            let mut existing = vec![ExistingWorkspaceWorktree {
                project_repository_id: repository_id,
                path: worktree.path,
                branch: worktree.branch,
            }];
            for candidate in state.store.repositories(&repository.project_id).await? {
                if candidate.id == selected_repository_id {
                    continue;
                }
                let matches = git_worktrees(&candidate.source_root)?
                    .into_iter()
                    .filter(|item| item.branch == branch)
                    .collect::<Vec<_>>();
                if matches.len() > 1 {
                    return Err(AppError::BadRequest(format!(
                        "multiple worktrees use branch '{}' in Repository '{}'",
                        branch, candidate.name
                    )));
                }
                if let Some(item) = matches.into_iter().next() {
                    if item.is_main
                        || normalized_path(&item.path) == normalized_path(&candidate.source_root)
                    {
                        return Err(AppError::BadRequest(format!(
                            "cannot reuse the main checkout of Repository '{}' for a Workspace; use a separate worktree",
                            candidate.name
                        )));
                    }
                    existing.push(ExistingWorkspaceWorktree {
                        project_repository_id: candidate.id,
                        path: item.path,
                        branch: item.branch,
                    });
                }
            }
            for item in &existing {
                if !std::path::Path::new(&item.path).is_dir() {
                    return Err(AppError::BadRequest(format!(
                        "worktree directory does not exist: {}",
                        item.path
                    )));
                }
                git_head(&item.path)?;
                for workspace in state.store.workspaces(&repository.project_id).await? {
                    if workspace.kind == "base" || workspace.status != "active" {
                        continue;
                    }
                    if state
                        .store
                        .workspace_repositories(&workspace.id)
                        .await?
                        .iter()
                        .any(|snapshot| {
                            snapshot.project_repository_id == item.project_repository_id
                                && snapshot.checkout_path.as_deref().is_some_and(|path| {
                                    normalized_path(path) == normalized_path(&item.path)
                                })
                        })
                    {
                        return Err(AppError::BadRequest(format!(
                            "worktree '{}' already belongs to Workspace '{}'",
                            item.path, workspace.name
                        )));
                    }
                }
            }
            create_workspace_with_existing_worktree(state, repository.project_id, input, existing)
                .await
        })
        .await?;
    Ok(created)
}
