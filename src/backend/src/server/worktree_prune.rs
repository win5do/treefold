use std::{path::Path, process::Command};

use axum::{Json, extract::State, http::StatusCode};

use super::{
    ApiJson, AppState, AxumPath, blocking_git_operation_for,
    git_routes::{command_output, normalized_path, parse_git_worktrees},
};
use crate::{
    error::{AppError, Result},
    model::{ProjectRepository, WorktreePruneEntry, WorktreePrunePreview},
};

pub(super) async fn preview(
    State(state): State<AppState>,
    AxumPath(repository_id): AxumPath<String>,
) -> Result<Json<WorktreePrunePreview>> {
    let repository = state.store.repository(&repository_id).await?;
    blocking_git_operation_for(repository.git_common_dir.clone(), move || async move {
        inspect(&state, &repository).await.map(Json)
    })
    .await
}

pub(super) async fn prune(
    State(state): State<AppState>,
    AxumPath(repository_id): AxumPath<String>,
    ApiJson(expected): ApiJson<WorktreePrunePreview>,
) -> Result<StatusCode> {
    let _workers = super::finish_batch::workers().lock().await;
    let repository = state.store.repository(&repository_id).await?;
    let runtime = state.runtime.clone();
    blocking_git_operation_for(repository.git_common_dir.clone(), move || async move {
        let current = inspect(&state, &repository).await?;
        if current != expected {
            return Err(AppError::api(
                StatusCode::CONFLICT,
                "WORKTREE_PRUNE_CHANGED",
                "Worktree registrations changed; review a new preview before pruning",
            ));
        }
        if !current.report.is_empty() {
            prune_output(&repository.source_root, false)?;
        }
        Ok(())
    })
    .await?;
    runtime.publish_sessions();
    Ok(StatusCode::NO_CONTENT)
}

async fn inspect(state: &AppState, repository: &ProjectRepository) -> Result<WorktreePrunePreview> {
    if state.store.project(&repository.project_id).await?.status != "active" {
        return Err(AppError::BadRequest(
            "cannot prune worktrees in an archived Project".into(),
        ));
    }
    let report = prune_output(&repository.source_root, true)?;
    let output = command_output(
        Path::new(&repository.source_root),
        "git",
        &["worktree", "list", "--porcelain", "-z", "--expire", "now"],
    )
    .map_err(AppError::BadRequest)?;
    let mut entries = Vec::new();
    for item in parse_git_worktrees(&output) {
        if item.is_main || item.locked_reason.is_some() {
            continue;
        }
        let Some(reason) = item.prunable_reason else {
            continue;
        };
        let mut workspaces = Vec::new();
        for workspace in state.store.workspaces(&repository.project_id).await? {
            if workspace.kind == "base" {
                continue;
            }
            if state
                .store
                .workspace_repositories(&workspace.id)
                .await?
                .iter()
                .any(|snapshot| {
                    snapshot.project_repository_id == repository.id
                        && snapshot.checkout_path.as_deref().is_some_and(|path| {
                            normalized_path(path) == normalized_path(&item.path)
                        })
                })
            {
                workspaces.push(workspace.name);
            }
        }
        workspaces.sort();
        entries.push(WorktreePruneEntry {
            path: item.path,
            reason,
            workspaces,
        });
    }
    entries.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(WorktreePrunePreview { report, entries })
}

// Git writes the verbose prune report to stderr, including for a dry run.
fn prune_output(repository: &str, dry_run: bool) -> Result<String> {
    let mut command = Command::new("git");
    command.current_dir(repository).env("LC_ALL", "C").args([
        "worktree",
        "prune",
        "--verbose",
        "--expire",
        "now",
    ]);
    if dry_run {
        command.arg("--dry-run");
    }
    let output = command
        .output()
        .map_err(|error| AppError::BadRequest(format!("git: {error}")))?;
    if !output.status.success() {
        return Err(AppError::BadRequest(
            String::from_utf8_lossy(&output.stderr).trim().into(),
        ));
    }
    Ok(String::from_utf8_lossy(&output.stderr).trim().into())
}
