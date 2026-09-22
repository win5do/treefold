use super::{AppError, AppState, AxumPath, Result, State, StatusCode};
use axum::{extract::Request, middleware::Next, response::Response};
use std::sync::OnceLock;
use tokio::sync::RwLock;

fn mutation_gate() -> &'static RwLock<()> {
    static GATE: OnceLock<RwLock<()>> = OnceLock::new();
    GATE.get_or_init(|| RwLock::new(()))
}

// Prevent a Session launch, Fork creation, or Git mutation racing record removal.
// Reads (including long-lived runtime streams) do not hold this gate. Finish
// workers outlive HTTP requests and are checked separately under their own lock.
pub(super) async fn guard_mutations(request: Request, next: Next) -> Response {
    if matches!(
        *request.method(),
        axum::http::Method::GET | axum::http::Method::HEAD | axum::http::Method::OPTIONS
    ) || request.uri().path().ends_with("/force-delete")
    {
        return next.run(request).await;
    }
    let _guard = mutation_gate().read().await;
    next.run(request).await
}

pub(super) async fn force_delete_workspace(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<StatusCode> {
    let _mutation = mutation_gate().write().await;
    let workers = super::finish_batch::workers().lock().await;
    let workspace = state.store.workspace(&id).await?;
    if !matches!(workspace.kind.as_str(), "workspace" | "fork") {
        return Err(unavailable());
    }
    let mut targets = state.store.forks(&id).await?;
    targets.push(workspace.clone());
    if targets.iter().any(|target| workers.contains(&target.id)) {
        return Err(AppError::api(
            StatusCode::CONFLICT,
            "FORCE_DELETE_OPERATION_ACTIVE",
            "Wait for the running Finish operation before deleting",
        ));
    }
    let repositories = state.store.workspace_repositories(&id).await?;
    let broken = super::blocking_git_operation(move || async move {
        for repository in &repositories {
            // Missing worktrees after successful, requested cleanup are expected.
            if matches!(
                repository.delivery_status.as_str(),
                "delivered" | "pushed" | "kept" | "discarded"
            ) {
                continue;
            }
            if let Err(AppError::Api { code, .. }) =
                super::workspace_repository_git_path(repository)
            {
                if matches!(
                    code,
                    "WORKTREE_DIRECTORY_MISSING" | "WORKTREE_NOT_GIT" | "WORKTREE_GIT_BROKEN"
                ) {
                    return Ok(true);
                }
            }
        }
        Ok(false)
    })
    .await?;
    if !broken {
        return Err(unavailable());
    }
    let mut sessions = Vec::new();
    for target in &targets {
        sessions.extend(state.store.sessions(&target.id).await?);
    }
    // Conflict resolvers may run in the parent Workspace or Project.
    for resolver in state.store.workspace_removal_resolvers(&id).await? {
        match state.store.session(&resolver).await {
            Ok(session) => sessions.push(session),
            Err(AppError::NotFound) => {}
            Err(error) => return Err(error),
        }
    }
    for session in sessions {
        if state
            .terminals
            .inspect_existing(&session.amux_workspace_name, &session.amux_process_name)
            .await?
            .is_some_and(|process| {
                matches!(
                    process.state,
                    amux::model::ProcessState::Created
                        | amux::model::ProcessState::Starting
                        | amux::model::ProcessState::Running
                        | amux::model::ProcessState::Stopping
                )
            })
        {
            return Err(AppError::api(
                StatusCode::CONFLICT,
                "FORCE_DELETE_SESSION_ACTIVE",
                "Stop running Sessions and conflict resolvers before deleting",
            ));
        }
    }
    state.store.force_delete_workspace(&id).await?;
    super::project_worktrees_cache()
        .invalidate(&workspace.project_id)
        .await;
    state.runtime.publish_sessions();
    Ok(StatusCode::NO_CONTENT)
}

fn unavailable() -> AppError {
    AppError::api(
        StatusCode::CONFLICT,
        "FORCE_DELETE_NOT_AVAILABLE",
        "Force delete is only available for a missing or invalid Git worktree. Check again before continuing.",
    )
}
