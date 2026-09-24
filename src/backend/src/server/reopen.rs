use super::{
    AppError, AppState, AxumPath, Json, Query, Result, State, StatusCode, Workspace,
    blocking_git_operation, command_output, ensure_checked_out_branch, git_operation_in_progress,
};
use std::path::Path;

fn unavailable() -> AppError {
    AppError::api(
        StatusCode::CONFLICT,
        "FORK_REOPEN_UNAVAILABLE",
        "Only archived Workspaces or Forks with retained checkouts and active parents can be reopened",
    )
}

#[derive(Default, serde::Deserialize)]
pub(super) struct ReopenOptions {
    #[serde(default)]
    pub confirm_squash: bool,
}

pub(super) async fn reopen_fork(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    Query(options): Query<ReopenOptions>,
) -> Result<Json<Workspace>> {
    // A parent Finish must not pass its active-Fork check while this Fork reopens.
    let workers = super::finish_batch::workers().lock().await;
    let workspace = state.store.workspace(&id).await?;
    if workers.contains(&id)
        || workspace
            .parent_workspace_id
            .as_ref()
            .is_some_and(|parent| workers.contains(parent))
    {
        return Err(unavailable());
    }
    if !options.confirm_squash && state.store.has_squash_delivery(&id).await? {
        return Err(AppError::api(
            StatusCode::CONFLICT,
            "FORK_REOPEN_SQUASH_CONFIRMATION_REQUIRED",
            "This Fork was squash-delivered. Confirm reopening with different parent and Fork histories, or create a new Fork from its parent.",
        ));
    }
    blocking_git_operation(move || async move { reopen_fork_impl(&state, &id).await.map(Json) })
        .await
}

pub(super) async fn reopen_fork_impl(state: &AppState, id: &str) -> Result<Workspace> {
    let workspace = state.store.workspace(id).await?;
    if !matches!(workspace.kind.as_str(), "workspace" | "fork")
        || workspace.status != "archived"
        || state.store.project(&workspace.project_id).await?.status != "active"
    {
        return Err(unavailable());
    }
    if let Some(parent_id) = workspace.parent_workspace_id.as_deref() {
        if state.store.workspace(parent_id).await?.status != "active"
            || state
                .store
                .finish_batch(parent_id)
                .await?
                .is_some_and(|b| !b.continue_work || b.status != "completed")
        {
            return Err(unavailable());
        }
    }
    if state
        .store
        .finish_batch(id)
        .await?
        .is_some_and(|batch| batch.status != "completed")
    {
        return Err(unavailable());
    }
    super::finish_recovery::ensure_stopped(state, id).await?;
    for location in state.store.workspace_repositories(id).await? {
        let path = location.checkout_path.as_deref().ok_or_else(unavailable)?;
        let branch = location.branch.as_deref().ok_or_else(unavailable)?;
        if !Path::new(path).is_dir() || location.close_outcome.as_deref() == Some("skipped") {
            return Err(unavailable());
        }
        let repository = state
            .store
            .repository(&location.project_repository_id)
            .await?;
        let common = command_output(
            Path::new(path),
            "git",
            &["rev-parse", "--path-format=absolute", "--git-common-dir"],
        )
        .map_err(|_| unavailable())?;
        let top = command_output(Path::new(path), "git", &["rev-parse", "--show-toplevel"])
            .map_err(|_| unavailable())?;
        if std::fs::canonicalize(common).ok()
            != std::fs::canonicalize(&repository.git_common_dir).ok()
            || std::fs::canonicalize(top).ok() != std::fs::canonicalize(path).ok()
        {
            return Err(unavailable());
        }
        ensure_checked_out_branch(path, branch, "Fork").map_err(|_| unavailable())?;
        if git_operation_in_progress(path)? {
            return Err(unavailable());
        }
    }
    state.store.reopen_fork(id).await?;
    state.runtime.publish_sessions();
    state.store.workspace(id).await
}
