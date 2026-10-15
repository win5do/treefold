use super::session::{CreateSession, prepare_session};
use super::{AppError, AppState, Json, Result, StatusCode};
use crate::model::{Session, Workspace};

pub(super) async fn create(
    state: AppState,
    workspace: Workspace,
    input: CreateSession,
) -> Result<(StatusCode, Json<Session>)> {
    let session = prepare_session(&state, &workspace, input).await?;
    Ok((
        StatusCode::CREATED,
        Json(schedule(state, workspace, session)),
    ))
}

fn schedule(state: AppState, workspace: Workspace, session: Session) -> Session {
    let pending = session.clone();
    state.runtime.publish_session(session.id.clone());
    crate::request_context::spawn(async move {
        let _mutation_guard = super::finish_recovery::mutation_gate().read().await;
        if let Err(error) = launch(&state, &workspace, session).await {
            log::error!("Session initialization failed: {error}");
        }
    });
    pending
}

pub(super) async fn retry(state: AppState, session: Session) -> Result<Json<Session>> {
    let workspace = state.store.workspace(&session.workspace_id).await?;
    if !state
        .store
        .begin_session_initialization(&session.id)
        .await?
    {
        return Err(AppError::api(
            StatusCode::CONFLICT,
            "SESSION_INITIALIZING",
            "Session is already initializing",
        ));
    }
    if let Err(error) = state
        .terminals
        .prepare_restart(&session.amux_workspace_name, &session.amux_process_name)
        .await
    {
        state
            .store
            .finish_session_initialization(&session.id, Some(&error.to_string()))
            .await?;
        state.runtime.publish_session(session.id.clone());
        return Err(error.into());
    }
    let session = state.store.session(&session.id).await?;
    Ok(Json(schedule(state, workspace, session)))
}

pub(super) async fn launch(
    state: &AppState,
    workspace: &Workspace,
    session: Session,
) -> Result<Session> {
    let id = session.id.clone();
    let worker_state = state.clone();
    let workspace = workspace.clone();
    let started = std::time::Instant::now();
    let result = super::blocking_git_operation(move || async move {
        let instructions =
            super::hosting::treefold_developer_instructions(&worker_state, &session, &workspace)
                .await?;
        log::info!(
            "Session context prepared id={} elapsed_ms={}",
            session.id,
            started.elapsed().as_millis()
        );
        let agents = worker_state.settings.load()?.agents;
        let process = worker_state
            .terminals
            .spawn(
                &session,
                &workspace.project_id,
                instructions.as_deref(),
                &agents,
            )
            .await
            .map_err(|error| AppError::BadRequest(error.to_string()))?;
        // Inspect once after spawning so a fast exit is not overwritten with running.
        let process = worker_state
            .terminals
            .inspect_existing(&session.amux_workspace_name, &session.amux_process_name)
            .await?
            .unwrap_or(process);
        worker_state
            .store
            .set_session_runtime(
                &session.id,
                match process.state {
                    amux::model::ProcessState::Created
                    | amux::model::ProcessState::Starting
                    | amux::model::ProcessState::Running => "running",
                    amux::model::ProcessState::Exited => "exited",
                    amux::model::ProcessState::Failed => "failed",
                    _ => "stopped",
                },
                process.exit_code.map(Into::into),
                &process.exit_signal,
                &process.command,
            )
            .await?;
        Ok(())
    })
    .await;
    let error = result.as_ref().err().map(ToString::to_string);
    state
        .store
        .finish_session_initialization(&id, error.as_deref())
        .await?;
    state.runtime.publish_session(id.clone());
    log::info!(
        "Session initialization finished id={id} elapsed_ms={} success={}",
        started.elapsed().as_millis(),
        result.is_ok()
    );
    result?;
    state.store.session(&id).await
}

pub(super) fn ensure_settled(session: &Session) -> Result<()> {
    if session.initializing {
        return Err(AppError::api(
            StatusCode::CONFLICT,
            "SESSION_INITIALIZING",
            "Session is still initializing; wait for startup to finish",
        ));
    }
    Ok(())
}

pub(super) async fn recover(state: &AppState) -> Result<()> {
    // Reconciliation runs first: retain any process that survived the backend restart.
    state.store.recover_session_initialization().await
}
