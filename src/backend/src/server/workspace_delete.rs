use super::{
    AppError, AppState, AxumPath, Query, Result, State, StatusCode, WorkspaceRepository,
    blocking_git_operation_for, command_output, ensure_checked_out_branch, ensure_clean_workspace,
    git_is_ancestor, git_operation_in_progress, git_ref_names, git_worktrees, normalized_path,
    remove_worktree_if_present,
};
use crate::model::{WorkspaceDeleteBranch, WorkspaceDeletePrecheck};
use axum::Json;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

#[derive(Clone, Default, Deserialize)]
pub(super) struct DeleteWorkspaceOptions {
    #[serde(default)]
    pub delete_worktrees: bool,
    #[serde(default)]
    pub delete_branches: bool,
    /// Explicit approval of the branch heads returned by delete-precheck.
    pub discard_token: Option<String>,
}

#[derive(Clone)]
struct CheckoutCleanup {
    workspace_name: String,
    location: WorkspaceRepository,
    repository: String,
    common_dir: String,
    managed_root: PathBuf,
    delete_branch: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct CheckedCleanup {
    head: Option<String>,
    undelivered_commits: u64,
}

pub(super) async fn delete_precheck(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    Query(options): Query<DeleteWorkspaceOptions>,
) -> Result<Json<WorkspaceDeletePrecheck>> {
    let _workers = super::finish_batch::workers().lock().await;
    let cleanups = collect_cleanups(&state, &id, &options).await?;
    let checked = inspect_cleanups(&state, &cleanups).await?;
    Ok(Json(precheck_result(&id, &cleanups, &checked)))
}

async fn collect_cleanups(
    state: &AppState,
    id: &str,
    options: &DeleteWorkspaceOptions,
) -> Result<Vec<CheckoutCleanup>> {
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
                    workspace_name: target.name.clone(),
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
    Ok(cleanups)
}

async fn inspect_cleanups(
    state: &AppState,
    cleanups: &[CheckoutCleanup],
) -> Result<Vec<CheckedCleanup>> {
    let mut checked = Vec::new();
    // Validate the entire cascade before removing any files. Recheck each item
    // under its repository lock before applying it; failed cleanup retains records.
    for cleanup in cleanups {
        let state = state.clone();
        let cleanup = cleanup.clone();
        checked.push(
            blocking_git_operation_for(cleanup.common_dir.clone(), move || async move {
                check_cleanup(&state, &cleanup).await
            })
            .await?,
        );
    }
    Ok(checked)
}

fn precheck_result(
    id: &str,
    cleanups: &[CheckoutCleanup],
    checked: &[CheckedCleanup],
) -> WorkspaceDeletePrecheck {
    let mut undelivered_branches = Vec::new();
    let mut snapshot = Vec::new();
    for (cleanup, check) in cleanups.iter().zip(checked) {
        snapshot.push((&cleanup.location.id, &check.head, check.undelivered_commits));
        if check.undelivered_commits > 0 {
            undelivered_branches.push(WorkspaceDeleteBranch {
                workspace_name: cleanup.workspace_name.clone(),
                repository_name: cleanup.location.repository_name.clone(),
                branch: cleanup.location.branch.clone().unwrap(),
                head: check.head.clone().unwrap(),
                commit_count: check.undelivered_commits,
            });
        }
    }
    // Bind approval to the complete cascade, including currently delivered branches.
    snapshot.sort_unstable_by(|a, b| a.0.cmp(b.0));
    let discard_token = (!undelivered_branches.is_empty()).then(|| {
        let bytes = serde_json::to_vec(&(id, snapshot)).expect("serializable deletion snapshot");
        format!("{:x}", Sha256::digest(bytes))
    });
    WorkspaceDeletePrecheck {
        undelivered_branches,
        discard_token,
    }
}

fn deletion_changed() -> AppError {
    AppError::api(
        StatusCode::CONFLICT,
        "WORKSPACE_DELETE_CHANGED",
        "Branches changed after confirmation; review the deletion again",
    )
}

pub(super) async fn delete_workspace(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    Query(options): Query<DeleteWorkspaceOptions>,
) -> Result<StatusCode> {
    // Serialize deletion with Finish and reopening, including archived children.
    let _workers = super::finish_batch::workers().lock().await;
    let cleanups = collect_cleanups(&state, &id, &options).await?;
    let checked = inspect_cleanups(&state, &cleanups).await?;
    let preview = precheck_result(&id, &cleanups, &checked);
    if options.discard_token.is_some() && options.discard_token != preview.discard_token {
        return Err(deletion_changed());
    }
    if !preview.undelivered_branches.is_empty() && options.discard_token.is_none() {
        return Err(AppError::Api {
            status: StatusCode::CONFLICT,
            code: "WORKSPACE_DELETE_UNDELIVERED",
            message: "Branches contain undelivered commits; keep local branches or explicitly confirm discarding them".into(),
            details: Some(serde_json::to_value(preview).unwrap()),
        });
    }
    for (cleanup, expected) in cleanups.into_iter().zip(checked) {
        let state = state.clone();
        blocking_git_operation_for(cleanup.common_dir.clone(), move || async move {
            let current = check_cleanup(&state, &cleanup).await?;
            if current != expected {
                return Err(deletion_changed());
            }
            if let Some(path) = cleanup.location.checkout_path.as_deref() {
                remove_worktree_if_present(&cleanup.repository, path, false)?;
            }
            if let Some(head) = current.head {
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

async fn check_cleanup(state: &AppState, cleanup: &CheckoutCleanup) -> Result<CheckedCleanup> {
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
        return Ok(CheckedCleanup {
            head: None,
            undelivered_commits: 0,
        });
    }
    let branch = location
        .branch
        .as_deref()
        .ok_or_else(|| AppError::BadRequest("Repository has no recorded branch".into()))?;
    if !git_ref_names(&cleanup.repository, "refs/heads")?
        .iter()
        .any(|b| b == branch)
    {
        return Ok(CheckedCleanup {
            head: None,
            undelivered_commits: 0,
        });
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
    let undelivered_commits = if delivered {
        0
    } else {
        command_output(
            Path::new(&cleanup.repository),
            "git",
            &["rev-list", "--count", &format!("{project_head}..{head}")],
        )
        .map_err(AppError::BadRequest)?
        .parse::<u64>()
        .map_err(|error| AppError::Internal(error.into()))?
    };
    Ok(CheckedCleanup {
        head: Some(head),
        undelivered_commits,
    })
}

fn canonical_path(path: impl AsRef<Path>) -> Result<PathBuf> {
    std::fs::canonicalize(path).map_err(|error| {
        AppError::BadRequest(format!("Cannot verify managed checkout ownership: {error}"))
    })
}
