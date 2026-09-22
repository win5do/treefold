use super::{AppError, AppState, Result, StatusCode};
use axum::{extract::Request, middleware::Next, response::Response};
use std::sync::OnceLock;
use tokio::sync::RwLock;

pub(super) fn mutation_gate() -> &'static RwLock<()> {
    static GATE: OnceLock<RwLock<()>> = OnceLock::new();
    GATE.get_or_init(|| RwLock::new(()))
}

// Serialize a forced skip with Session launches and other mutations.
// Reads (including long-lived runtime streams) do not hold this gate. Finish
// workers outlive HTTP requests and take the exclusive gate only while skipping.
pub(super) async fn guard_mutations(request: Request, next: Next) -> Response {
    if matches!(
        *request.method(),
        axum::http::Method::GET | axum::http::Method::HEAD | axum::http::Method::OPTIONS
    ) {
        return next.run(request).await;
    }
    let _guard = mutation_gate().read().await;
    next.run(request).await
}

pub(super) async fn ensure_stopped(state: &AppState, id: &str) -> Result<()> {
    let mut targets = state.store.forks(id).await?;
    targets.push(state.store.workspace(id).await?);
    let mut sessions = Vec::new();
    for target in &targets {
        sessions.extend(state.store.sessions(&target.id).await?);
    }
    // Conflict resolvers may run in the parent Workspace or Project.
    for resolver in state.store.finish_resolver_sessions(id).await? {
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
                "FINISH_SESSION_ACTIVE",
                "Stop running Sessions and conflict resolvers before continuing",
            ));
        }
    }
    Ok(())
}
