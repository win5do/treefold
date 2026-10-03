//! Schedule metadata reads and commit results; vendor formats live in agents/.
use super::*;

pub(super) async fn capture_pending_agent_sessions(state: &AppState) -> Result<()> {
    let mut sessions = state.store.uncaptured_agent_sessions().await?;
    for (id, _) in state.store.pending_agent_titles().await? {
        sessions.push(state.store.session(&id).await?);
    }
    let home = state.settings.treefold_home();
    let results = tokio::task::spawn_blocking(move || {
        let mut results = Vec::new();
        for kind in crate::settings::AGENT_KINDS {
            let sessions: Vec<_> = sessions
                .iter()
                .filter(|session| session.kind == kind)
                .collect();
            let directories: Vec<_> = sessions
                .iter()
                .map(|session| crate::agents::runtime_dir(&home, kind, &session.id))
                .collect();
            let contexts: Vec<_> = sessions
                .iter()
                .zip(&directories)
                .map(|(session, directory)| crate::agents::MetadataContext {
                    session_id: &session.id,
                    original_cwd: &session.original_cwd,
                    argv: &session.argv,
                    native_id: session.agent_session_id.as_deref(),
                    runtime_dir: directory,
                    read_title: session.agent_session_id.is_some(),
                })
                .collect();
            for (session, metadata) in sessions
                .into_iter()
                .zip(crate::agents::read_metadata_batch(kind, &contexts))
            {
                results.push((session.id.clone(), metadata));
            }
        }
        results
    })
    .await
    .map_err(|error| anyhow::anyhow!(error))?;
    for (id, metadata) in results {
        if let Some(native_id) = metadata.id {
            let mut changed = state.store.set_agent_session_id(&id, &native_id).await?;
            if let Some(title) = metadata.title {
                changed |= state
                    .store
                    .import_agent_title(&id, &native_id, &title)
                    .await?;
            }
            if changed {
                state.runtime.publish_session_list(Some(id));
            }
        }
    }
    Ok(())
}

pub(super) async fn capture_agent_session_id(
    state: &AppState,
    session: &mut Session,
) -> Result<()> {
    if crate::agents::name(&session.kind).is_none() || session.agent_session_id.is_some() {
        return Ok(());
    }
    if let Some(id) = discover(state, session, false).await?.id {
        state.store.set_agent_session_id(&session.id, &id).await?;
        session.agent_session_id = state.store.session(&session.id).await?.agent_session_id;
        state.runtime.publish_session_list(Some(session.id.clone()));
    }
    Ok(())
}

async fn discover(
    state: &AppState,
    session: &Session,
    read_title: bool,
) -> Result<crate::agents::AgentMetadata> {
    let session = session.clone();
    let directory =
        crate::agents::runtime_dir(&state.settings.treefold_home(), &session.kind, &session.id);
    tokio::task::spawn_blocking(move || {
        crate::agents::read_metadata(
            &session.kind,
            &crate::agents::MetadataContext {
                session_id: &session.id,
                original_cwd: &session.original_cwd,
                argv: &session.argv,
                native_id: session.agent_session_id.as_deref(),
                runtime_dir: &directory,
                read_title,
            },
        )
    })
    .await
    .map_err(|error| anyhow::anyhow!(error).into())
}

pub(super) async fn validate_agent_resume(state: &AppState, session: &Session) -> Result<()> {
    if crate::agents::name(&session.kind).is_none() {
        return Ok(());
    }
    let session = session.clone();
    let directory =
        crate::agents::runtime_dir(&state.settings.treefold_home(), &session.kind, &session.id);
    tokio::task::spawn_blocking(move || {
        crate::agents::validate_resume(
            &session.kind,
            &crate::agents::MetadataContext {
                session_id: &session.id,
                original_cwd: &session.original_cwd,
                argv: &session.argv,
                native_id: session.agent_session_id.as_deref(),
                runtime_dir: &directory,
                read_title: false,
            },
        )
    })
    .await
    .map_err(|error| anyhow::anyhow!(error))?
    .map_err(|error| {
        AppError::api(
            StatusCode::CONFLICT,
            "AGENT_HISTORY_UNAVAILABLE",
            error.to_string(),
        )
    })
}
