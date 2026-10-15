use super::workspace::{
    CreatedWorkspace, WorkspaceWorktreeOutcome, WorkspaceWorktreePlan, create_workspace_worktree,
    record_workspace_worktree_outcomes, start_workspace_setup_shells,
};
use super::worktree_names::WorktreeRoot;
use super::{AppError, AppState, Result, StatusCode};
use crate::model::Workspace;
use futures_util::{StreamExt, stream};

pub(super) struct PreparedWorkspace {
    pub workspace: Workspace,
    pub plans: Vec<WorkspaceWorktreePlan>,
    // Keep the directory reservation until its checkouts have been created.
    pub root: WorktreeRoot,
}

pub(super) async fn complete(
    state: &AppState,
    prepared: PreparedWorkspace,
) -> Result<CreatedWorkspace> {
    let PreparedWorkspace {
        workspace,
        plans,
        root: _root,
    } = prepared;
    let mut outcomes = stream::iter(plans.into_iter().map(|plan| async move {
        let fallback = plan.clone();
        let common = plan
            .location
            .git_common_dir
            .clone()
            .unwrap_or_else(|| plan.location.path.clone());
        super::blocking_git_operation_for(common, move || async move {
            Ok(create_workspace_worktree(plan))
        })
        .await
        .unwrap_or_else(|error| WorkspaceWorktreeOutcome {
            plan: fallback,
            start_commit: None,
            error: Some(error.to_string()),
        })
    }))
    .buffer_unordered(crate::git_parallel::REPOSITORY_CONCURRENCY);
    let mut setup_shells = Vec::new();
    let mut persistence_error = None;
    while let Some(outcome) = outcomes.next().await {
        match record_workspace_worktree_outcomes(&state.store, vec![outcome]).await {
            Ok(setups) => setup_shells.extend(setups),
            Err(error) => persistence_error = Some(error),
        }
        state.runtime.publish_sessions();
    }
    // Drain all workers before releasing the root reservation, even on write failure.
    if let Some(error) = persistence_error {
        return Err(error);
    }
    Ok(CreatedWorkspace {
        workspace: state.store.workspace(&workspace.id).await?,
        setup_shells,
    })
}

pub(super) fn start(state: AppState, prepared: PreparedWorkspace) {
    state.runtime.publish_sessions();
    crate::request_context::spawn(async move {
        let _mutation_guard = super::finish_recovery::mutation_gate().read().await;
        let id = prepared.workspace.id.clone();
        let worker_state = state.clone();
        let result = super::blocking_git_operation(move || async move {
            complete(&worker_state, prepared).await
        })
        .await;
        match result {
            Ok(created) => {
                state.runtime.publish_sessions();
                start_workspace_setup_shells(&state, &created.workspace, created.setup_shells)
                    .await;
            }
            Err(error) => {
                log::error!("Workspace initialization failed id={id}: {error}");
                if let Err(error) = state
                    .store
                    .fail_workspace_creation(&id, &error.to_string())
                    .await
                {
                    log::error!("could not persist Workspace initialization failure: {error}");
                }
            }
        }
        state.runtime.publish_sessions();
    });
}

pub(super) async fn ensure_ready(state: &AppState, id: &str) -> Result<()> {
    if state
        .store
        .workspace_repositories(id)
        .await?
        .iter()
        .any(|repository| repository.git_status == "creating")
    {
        return Err(AppError::api(
            StatusCode::CONFLICT,
            "WORKSPACE_INITIALIZING",
            "Workspace is still initializing; wait for its repositories to finish",
        ));
    }
    Ok(())
}

pub(super) async fn recover(state: &AppState) -> Result<()> {
    state.store.recover_workspace_creation().await
}
