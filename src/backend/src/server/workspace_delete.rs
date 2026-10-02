use super::{
    AppError, AppState, AxumPath, Query, Result, State, StatusCode, WorkspaceRepository,
    blocking_git_operation_for, command_output, ensure_checked_out_branch, ensure_clean_workspace,
    git_is_ancestor, git_operation_in_progress, git_ref_names, git_worktrees, normalized_path,
    remove_worktree_if_present,
};
use serde::Deserialize;
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Default, Deserialize)]
pub(super) struct DeleteWorkspaceOptions {
    #[serde(default)]
    pub delete_worktrees: bool,
    #[serde(default)]
    pub delete_branches: bool,
}

#[derive(Clone)]
struct CheckoutCleanup {
    location: WorkspaceRepository,
    repository: String,
    common_dir: String,
    managed_root: PathBuf,
    delete_branch: bool,
}

pub(super) async fn delete_workspace(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    Query(options): Query<DeleteWorkspaceOptions>,
) -> Result<StatusCode> {
    // Serialize deletion with Finish and reopening, including archived children.
    let _workers = super::finish_batch::workers().lock().await;
    if options.delete_branches && !options.delete_worktrees {
        return Err(AppError::BadRequest(
            "Keep the checked-out branches when keeping working directories".into(),
        ));
    }
    let workspace = state.store.workspace(&id).await?;
    if workspace.kind == "base" || workspace.status != "archived" {
        return Err(AppError::BadRequest(
            "Finish the Workspace or Fork before permanently deleting it".into(),
        ));
    }
    let mut targets = state.store.forks(&id).await?;
    targets.push(workspace);
    let mut cleanups = Vec::new();
    for target in &targets {
        if target.status != "archived" {
            return Err(AppError::BadRequest(
                "Finish all Forks before permanently deleting this Workspace".into(),
            ));
        }
        super::finish_recovery::ensure_stopped(&state, &target.id).await?;
        if options.delete_worktrees {
            for location in state.store.workspace_repositories(&target.id).await? {
                if location.worktree_ownership != "managed" {
                    continue;
                }
                let repository = state
                    .store
                    .repository(&location.project_repository_id)
                    .await?;
                cleanups.push(CheckoutCleanup {
                    delete_branch: options.delete_branches
                        && location.branch_ownership == "managed",
                    location,
                    repository: repository.source_root,
                    common_dir: repository.git_common_dir,
                    managed_root: state.settings.treefold_home().join("git/w"),
                });
            }
        }
    }
    // Validate the entire cascade before removing any files. Recheck each item
    // under its repository lock before applying it; failed cleanup retains records.
    for cleanup in &cleanups {
        let state = state.clone();
        let cleanup = cleanup.clone();
        blocking_git_operation_for(cleanup.common_dir.clone(), move || async move {
            check_cleanup(&state, &cleanup).await.map(|_| ())
        })
        .await?;
    }
    for cleanup in cleanups {
        let state = state.clone();
        blocking_git_operation_for(cleanup.common_dir.clone(), move || async move {
            let head = check_cleanup(&state, &cleanup).await?;
            if let Some(path) = cleanup.location.checkout_path.as_deref() {
                remove_worktree_if_present(&cleanup.repository, path, false)?;
            }
            if let Some(head) = head {
                let branch = cleanup.location.branch.as_deref().unwrap();
                // Git's expected-value check refuses a concurrent new commit.
                command_output(
                    Path::new(&cleanup.repository),
                    "git",
                    &["update-ref", "-d", &format!("refs/heads/{branch}"), &head],
                )
                .map_err(AppError::BadRequest)?;
            }
            Ok(())
        })
        .await?;
    }
    state.store.delete_workspace(&id).await?;
    state.runtime.publish_sessions();
    Ok(StatusCode::NO_CONTENT)
}

async fn check_cleanup(state: &AppState, cleanup: &CheckoutCleanup) -> Result<Option<String>> {
    let location = &cleanup.location;
    let path = location.checkout_path.as_deref().ok_or_else(|| {
        AppError::BadRequest(
            "Repository has no recorded worktree; choose to keep its working directory".into(),
        )
    })?;
    let expected = normalized_path(path);
    if !Path::new(&expected).starts_with(normalized_path(
        cleanup.managed_root.to_string_lossy().as_ref(),
    )) {
        return Err(AppError::BadRequest("Checkout is outside Treefold's managed worktree root; choose to keep working directories".into()));
    }
    let worktrees = git_worktrees(&cleanup.repository)?;
    let registered = worktrees
        .iter()
        .any(|w| normalized_path(&w.path) == expected);
    if Path::new(path).exists() {
        let root = canonical_path(&cleanup.managed_root)?;
        if !canonical_path(path)?.starts_with(root) || !registered {
            return Err(AppError::BadRequest(
                "Worktree ownership changed; choose to keep working directories".into(),
            ));
        }
        let common = command_output(
            Path::new(path),
            "git",
            &["rev-parse", "--path-format=absolute", "--git-common-dir"],
        )
        .map_err(AppError::BadRequest)?;
        if canonical_path(common)? != canonical_path(&cleanup.common_dir)? {
            return Err(AppError::BadRequest(
                "Worktree belongs to a different repository".into(),
            ));
        }
        ensure_clean_workspace(path, &location.repository_name)?;
        ensure_checked_out_branch(
            path,
            location.branch.as_deref().unwrap_or(""),
            "Workspace Repository",
        )?;
        if git_operation_in_progress(path)? {
            return Err(AppError::BadRequest(
                "Finish or abort the in-progress Git operation before deleting its worktree".into(),
            ));
        }
    }
    if !cleanup.delete_branch {
        return Ok(None);
    }
    let branch = location
        .branch
        .as_deref()
        .ok_or_else(|| AppError::BadRequest("Repository has no recorded branch".into()))?;
    if !git_ref_names(&cleanup.repository, "refs/heads")?
        .iter()
        .any(|b| b == branch)
    {
        return Ok(None);
    }
    if worktrees
        .iter()
        .any(|w| w.branch == branch && normalized_path(&w.path) != expected)
    {
        return Err(AppError::BadRequest(
            "Branch is checked out by another worktree; choose to keep local branches".into(),
        ));
    }
    let head = command_output(
        Path::new(&cleanup.repository),
        "git",
        &["rev-parse", &format!("refs/heads/{branch}")],
    )
    .map_err(AppError::BadRequest)?;
    let project_head = command_output(
        Path::new(&cleanup.repository),
        "git",
        &["rev-parse", "HEAD"],
    )
    .map_err(AppError::BadRequest)?;
    let mut delivered = git_is_ancestor(&cleanup.repository, &head, &project_head)?;
    if !delivered
        && let Some(operation) = state
            .store
            .latest_parent_operation(&location.id, "integrate")
            .await?
    {
        if operation.status == "completed" && operation.source_head == head {
            if let Some(result) = operation.result_head {
                let target = format!("refs/heads/{}", operation.target_branch);
                delivered = git_is_ancestor(&cleanup.repository, &result, &target).unwrap_or(false);
            }
        }
    }
    if !delivered && location.close_outcome.as_deref() == Some("push_branch") {
        if let (Some(remote), Some(branch)) = (&location.remote_name, &location.remote_branch) {
            delivered = git_is_ancestor(
                &cleanup.repository,
                &head,
                &format!("refs/remotes/{remote}/{branch}"),
            )
            .unwrap_or(false);
        }
    }
    if !delivered {
        return Err(AppError::BadRequest(
            "Branch contains undelivered commits; choose to keep local branches".into(),
        ));
    }
    Ok(Some(head))
}

fn canonical_path(path: impl AsRef<Path>) -> Result<PathBuf> {
    std::fs::canonicalize(path).map_err(|error| {
        AppError::BadRequest(format!("Cannot verify managed checkout ownership: {error}"))
    })
}
