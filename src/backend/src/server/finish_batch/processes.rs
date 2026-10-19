use super::super::{AppState, AxumPath, Json, Result, State};
use crate::{
    model::{FinishProcess, Session},
    terminal::TreefoldProcessView,
};

pub(crate) async fn list(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Vec<FinishProcess>>> {
    state.store.workspace(&id).await?;
    let sessions = state.store.sessions(&id).await?;
    // Use the daemon's current snapshot, not persisted Session status or the
    // event cache. This read must never start an absent daemon.
    let processes = state
        .terminals
        .existing_processes()
        .await?
        .unwrap_or_default();
    Ok(Json(affected_processes(&sessions, &processes)))
}

fn affected_processes(
    sessions: &[Session],
    processes: &[TreefoldProcessView],
) -> Vec<FinishProcess> {
    // Match the exact roots that the existing delivery/archive path stops.
    // Other Workspaces and independently managed background processes are not
    // stopped by delivery and must not be presented as affected here.
    sessions
        .iter()
        .filter_map(|session| {
            let process = processes.iter().find(|process| {
                process.workspace_name == session.amux_workspace_name
                    && process.name == session.amux_process_name
                    && matches!(
                        process.state.as_str(),
                        "created" | "starting" | "running" | "stopping"
                    )
            })?;
            Some(FinishProcess {
                session_id: session.id.clone(),
                name: session.name.clone(),
                kind: session.kind.clone(),
                state: process.state.clone(),
                pid: process.pid,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests;
