//! Shared checkout behavior for Project and Workspace repositories.
use super::delivery::git_head;
use super::git_routes::{command_output, directory_branches};
use super::parent_operation::git_operation_in_progress;
use super::{
    ApiJson, AppError, AppState, AxumPath, Json, Result, State, StatusCode, blocking_git_operation,
    blocking_git_operation_for,
};
use serde::Deserialize;
use std::path::Path;

#[derive(Deserialize)]
pub(super) struct CheckoutBranch {
    pub kind: String,
    pub branch: String,
    pub remote: Option<String>,
    pub local_branch: Option<String>,
    pub base: Option<super::workspace_checkout::BranchRef>,
    pub expected_branch: Option<String>,
    pub expected_head: Option<String>,
}

pub(super) fn checkout(path: &str, input: &CheckoutBranch) -> Result<bool> {
    let branches = directory_branches(path)?;
    if input
        .expected_branch
        .as_ref()
        .is_some_and(|value| value != &branches.current)
        || input
            .expected_head
            .as_ref()
            .is_some_and(|value| git_head(path).as_ref().ok() != Some(value))
    {
        return Err(AppError::api(
            StatusCode::CONFLICT,
            "GIT_STATE_STALE",
            "Checkout changed; refresh the branch list and try again",
        ));
    }
    if git_operation_in_progress(path)? {
        return Err(AppError::BadRequest(
            "Finish or abort the Git operation before switching branches".into(),
        ));
    }
    let branch = input.local_branch.as_deref().unwrap_or(&input.branch);
    valid_branch(path, branch)?;
    let mut created = false;
    match input.kind.as_str() {
        "local" => {
            if input
                .local_branch
                .as_ref()
                .is_some_and(|name| name != &input.branch)
                || !branches.local.contains(&input.branch)
            {
                return Err(AppError::BadRequest("local branch was not found".into()));
            }
            command_output(Path::new(path), "git", &["switch", "--no-guess", branch])
                .map_err(AppError::BadRequest)?;
        }
        "remote" => {
            let remote = input
                .remote
                .as_deref()
                .ok_or_else(|| AppError::BadRequest("remote is required".into()))?;
            let reference = resolve_ref(
                path,
                &super::workspace_checkout::BranchRef::Remote {
                    remote: remote.into(),
                    branch: input.branch.clone(),
                },
            )?;
            if branches.local.iter().any(|name| name == branch) {
                return Err(AppError::BadRequest("Local branch already exists; select it under Local or choose another local name".into()));
            }
            command_output(
                Path::new(path),
                "git",
                &["switch", "--track", "-c", branch, &reference],
            )
            .map_err(AppError::BadRequest)?;
            created = true;
        }
        "new" => {
            let reference = input
                .base
                .as_ref()
                .map(|base| resolve_ref(path, base))
                .transpose()?
                .unwrap_or_else(|| "HEAD".into());
            command_output(
                Path::new(path),
                "git",
                &["switch", "--no-track", "-c", branch, &reference],
            )
            .map_err(AppError::BadRequest)?;
            created = true;
        }
        _ => {
            return Err(AppError::BadRequest(
                "kind must be local, remote or new".into(),
            ));
        }
    }
    Ok(created)
}

fn valid_branch(path: &str, branch: &str) -> Result<()> {
    if branch.is_empty() || branch.starts_with('-') || branch == "HEAD" {
        return Err(AppError::BadRequest("invalid branch name".into()));
    }
    command_output(
        Path::new(path),
        "git",
        &["check-ref-format", &format!("refs/heads/{branch}")],
    )
    .map_err(AppError::BadRequest)?;
    Ok(())
}

fn resolve_ref(path: &str, base: &super::workspace_checkout::BranchRef) -> Result<String> {
    use super::workspace_checkout::BranchRef;
    let reference = match base {
        BranchRef::Local { branch } => {
            valid_branch(path, branch)?;
            format!("refs/heads/{branch}")
        }
        BranchRef::Remote { remote, branch } => {
            valid_branch(path, branch)?;
            if !super::git_routes::git_remote_names(path)?.contains(remote) {
                return Err(AppError::BadRequest("remote was not found".into()));
            }
            format!("refs/remotes/{remote}/{branch}")
        }
    };
    command_output(
        Path::new(path),
        "git",
        &["rev-parse", "--verify", &format!("{reference}^{{commit}}")],
    )
    .map_err(AppError::BadRequest)?;
    Ok(reference)
}

pub(super) async fn ensure_idle(state: &AppState, repository_id: &str, path: &str) -> Result<()> {
    if state
        .store
        .checkout_has_active_operation(repository_id, path)
        .await?
    {
        return Err(AppError::BadRequest(
            "Finish the active delivery or parent operation before switching branches".into(),
        ));
    }
    Ok(())
}

pub(super) async fn workspace_branches(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<super::GitBranches>> {
    let location = state.store.workspace_repository(&id).await?;
    let path = super::git_routes::workspace_repository_git_path(&location)?.to_owned();
    blocking_git_operation(move || async move { Ok(Json(directory_branches(&path)?)) }).await
}

pub(super) async fn workspace_checkout(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<CheckoutBranch>,
) -> Result<Json<super::WorkspaceRepository>> {
    let location = state.store.workspace_repository(&id).await?;
    let _lifecycle = super::workspace_lifecycle::lock(&state, &location.workspace_id).await?;
    super::workspace_lifecycle::ensure_idle(&state, &location.workspace_id).await?;
    let common = state
        .store
        .repository(&location.project_repository_id)
        .await?
        .git_common_dir;
    blocking_git_operation_for(common, move || async move {
        let location = state.store.workspace_repository(&id).await?;
        let workspace = state.store.workspace(&location.workspace_id).await?;
        super::workspace::ensure_active_project(
            &state.store.project(&workspace.project_id).await?,
        )?;
        if workspace.kind != "workspace"
            || workspace.status != "active"
            || location.git_status != "ready"
            || location.access_mode != "read_write"
        {
            return Err(AppError::BadRequest(
                "Branch switching requires an active writable Workspace Repository".into(),
            ));
        }
        if state
            .store
            .finish_batch(&workspace.id)
            .await?
            .is_some_and(|batch| !batch.continue_work || batch.status != "completed")
        {
            return Err(AppError::BadRequest(
                "Complete or reopen Finish before switching branches".into(),
            ));
        }
        let path = super::git_routes::workspace_repository_git_path(&location)?.to_owned();
        ensure_idle(&state, &location.project_repository_id, &path).await?;
        let created = checkout(&path, &input)?;
        if created {
            state
                .store
                .track_workspace_branch(&id, input.local_branch.as_deref().unwrap_or(&input.branch))
                .await?;
        }
        state.runtime.publish_sessions();
        Ok(Json(state.store.workspace_repository(&id).await?))
    })
    .await
}
