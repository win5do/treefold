use std::{
    collections::{HashMap, HashSet},
    env,
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};

use crate::{
    error::{ApiJson, AppError, Result},
    git,
    ids::new_id,
    integration::IntegrationManager,
    model::*,
    settings::{SettingsPatch, SettingsStore},
    store::{ParentOperationUpdate, Store, now},
    terminal::TerminalManager,
};
use axum::{
    Json, Router,
    extract::{
        Path as AxumPath, Query, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::{HeaderMap, Method, StatusCode},
    response::{
        IntoResponse,
        sse::{Event, KeepAlive, Sse},
    },
    routing::{get, patch, post},
};
use futures_util::{SinkExt, StreamExt, stream};
use moka::future::Cache;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    convert::Infallible,
    sync::{
        Arc, OnceLock,
        atomic::{AtomicU64, Ordering},
    },
};
use tower_http::cors::CorsLayer;

#[derive(Clone)]
pub struct AppState {
    pub keymap: crate::keymap::KeymapStore,
    pub store: Store,
    pub settings: SettingsStore,
    pub terminals: TerminalManager,
    pub runtime: RuntimeHub,
    pub integration: IntegrationManager,
}

#[derive(Clone)]
pub struct RuntimeHub {
    instance_id: Arc<str>,
    revision: Arc<AtomicU64>,
    changes: tokio::sync::broadcast::Sender<RuntimeChange>,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeDomain {
    Sidebar,
    Sessions,
    Processes,
    Amux,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct RuntimeCursor {
    pub instance_id: String,
    pub revision: u64,
}

#[derive(Clone, Debug, Serialize)]
pub struct RuntimeChange {
    pub instance_id: String,
    pub revision: u64,
    pub domains: Vec<RuntimeDomain>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

impl Default for RuntimeHub {
    fn default() -> Self {
        let (changes, _) = tokio::sync::broadcast::channel(256);
        Self {
            instance_id: Arc::from(new_id()),
            revision: Arc::new(AtomicU64::new(0)),
            changes,
        }
    }
}

impl RuntimeHub {
    pub fn revision(&self) -> u64 {
        self.revision.load(Ordering::Acquire)
    }

    pub fn cursor(&self) -> RuntimeCursor {
        RuntimeCursor {
            instance_id: self.instance_id.to_string(),
            revision: self.revision(),
        }
    }

    pub fn subscribe(&self) -> tokio::sync::broadcast::Receiver<RuntimeChange> {
        self.changes.subscribe()
    }

    pub fn subscribe_with_cursor(
        &self,
    ) -> (
        tokio::sync::broadcast::Receiver<RuntimeChange>,
        RuntimeCursor,
    ) {
        let receiver = self.subscribe();
        let cursor = self.cursor();
        (receiver, cursor)
    }

    pub fn publish(&self, domains: &[RuntimeDomain], session_id: Option<String>) {
        let revision = self.revision.fetch_add(1, Ordering::AcqRel) + 1;
        let _ = self.changes.send(RuntimeChange {
            instance_id: self.instance_id.to_string(),
            revision,
            domains: domains.to_vec(),
            session_id,
        });
    }

    pub fn publish_session(&self, session_id: impl Into<String>) {
        self.publish(
            &[
                RuntimeDomain::Sidebar,
                RuntimeDomain::Sessions,
                RuntimeDomain::Processes,
            ],
            Some(session_id.into()),
        );
    }

    pub fn publish_session_list(&self, session_id: Option<String>) {
        self.publish(
            &[RuntimeDomain::Sidebar, RuntimeDomain::Sessions],
            session_id,
        );
    }

    pub fn publish_sessions(&self) {
        self.publish(
            &[
                RuntimeDomain::Sidebar,
                RuntimeDomain::Sessions,
                RuntimeDomain::Processes,
            ],
            None,
        );
    }

    pub fn publish_daemon_stopped(&self) {
        self.publish(
            &[
                RuntimeDomain::Sidebar,
                RuntimeDomain::Sessions,
                RuntimeDomain::Processes,
                RuntimeDomain::Amux,
            ],
            None,
        );
    }
}

static PROJECT_WORKTREES: OnceLock<Cache<String, Vec<GitWorktree>>> = OnceLock::new();
static LOCATION_OBSERVATIONS: OnceLock<Cache<String, Directory>> = OnceLock::new();

fn project_worktrees_cache() -> &'static Cache<String, Vec<GitWorktree>> {
    PROJECT_WORKTREES.get_or_init(|| {
        Cache::builder()
            .max_capacity(256)
            .time_to_live(std::time::Duration::from_secs(10))
            .build()
    })
}

fn location_observations_cache() -> &'static Cache<String, Directory> {
    LOCATION_OBSERVATIONS.get_or_init(|| {
        Cache::builder()
            .max_capacity(256)
            .time_to_live(std::time::Duration::from_secs(10))
            .build()
    })
}

pub async fn bind() -> anyhow::Result<tokio::net::TcpListener> {
    let bind_addr = env::var("TREEFOLD_API_ADDR").unwrap_or_else(|_| "127.0.0.1:0".into());
    Ok(tokio::net::TcpListener::bind(&bind_addr).await?)
}

pub async fn serve(listener: tokio::net::TcpListener, state: AppState) -> anyhow::Result<()> {
    let mut process_events = state.terminals.subscribe_process_events();
    let mut snapshot_events = state.terminals.subscribe_snapshot_events();
    state.terminals.connect_existing().await;
    reconcile_daemon_sessions(&state).await?;
    let bridge_state = state.clone();
    tokio::spawn(async move {
        let mut fallback = tokio::time::interval(Duration::from_secs(30));
        fallback.tick().await;
        let mut identity_poll = tokio::time::interval(Duration::from_secs(2));
        identity_poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tokio::select! {
                event = process_events.recv() => match event {
                    Ok(event) => {
                        if let Err(error) = reconcile_process_event(&bridge_state, event).await {
                            log::error!("failed to reconcile amux process event: {error}");
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        let _ = reconcile_daemon_sessions(&bridge_state).await;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                },
                snapshot = snapshot_events.recv() => match snapshot {
                    Ok(()) | Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        let _ = reconcile_daemon_sessions(&bridge_state).await;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                },
                _ = identity_poll.tick() => {
                    if let Err(error) = capture_pending_codex_sessions(&bridge_state).await {
                        log::error!("failed to capture Codex session identity: {error}");
                    }
                }
                _ = fallback.tick() => {
                    let _ = reconcile_daemon_sessions(&bridge_state).await;
                }
            }
        }
    });
    let app = app(state);
    log::info!("Rust API listening on http://{}", listener.local_addr()?);
    axum::serve(listener, app).await?;
    Ok(())
}

fn app(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(tower_http::cors::Any)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PATCH,
            Method::PUT,
            Method::DELETE,
        ])
        .allow_headers(tower_http::cors::Any)
        .expose_headers([http::HeaderName::from_static("x-request-id")]);
    Router::new()
        .route("/api/health", get(health))
        .route("/api/v1/agent/current", get(agent_current))
        .route(
            "/api/v1/agent/todos",
            get(agent_list_todos).post(agent_create_todo),
        )
        .route(
            "/api/v1/agent/todos/{id}",
            get(agent_get_todo)
                .patch(agent_edit_todo)
                .delete(agent_delete_todo),
        )
        .route("/api/v1/agent/todos/{id}/block", post(agent_block_todo))
        .route("/api/system", get(system_status))
        .route("/api/system/logs/reveal", post(reveal_runtime_logs))
        .route("/api/amux", get(amux_status))
        .route("/api/amux/stop", post(stop_amux))
        .route(
            "/api/agent-integration",
            get(agent_integration_status)
                .post(sync_agent_integration)
                .delete(uninstall_agent_integration),
        )
        .route("/api/processes", get(list_background_processes))
        .route("/api/events", get(runtime_events))
        .route("/api/events/revision", get(runtime_revision))
        .route("/api/projects", get(list_projects).post(create_project))
        .route("/api/projects/summary", get(list_project_summaries))
        .route("/api/sidebar", get(get_sidebar))
        .route(
            "/api/projects/{id}",
            get(get_project)
                .patch(update_project)
                .delete(delete_project),
        )
        .route(
            "/api/projects/{id}/delete-precheck",
            get(precheck_delete_project),
        )
        .route("/api/projects/{id}/git/pull-all", post(pull_all_project))
        .route("/api/projects/{id}/git/push-all", post(push_all_project))
        .route(
            "/api/projects/{id}/sessions",
            get(list_project_sessions).post(create_project_session),
        )
        .route("/api/projects/{id}/reveal", post(reveal_project))
        .route(
            "/api/projects/{id}/directories",
            get(list_project_directories).post(create_directory),
        )
        .route(
            "/api/project-directories/inspect",
            post(inspect_project_directory),
        )
        .route(
            "/api/project-directories/{id}",
            get(get_project_directory)
                .patch(update_directory)
                .delete(delete_project_directory),
        )
        .route(
            "/api/project-directories/{id}/refresh",
            post(refresh_project_directory),
        )
        .route(
            "/api/projects/{id}/repositories/clone",
            post(clone_project_repository),
        )
        .route(
            "/api/project-repositories/{id}",
            get(get_project_repository)
                .patch(update_project_repository)
                .delete(delete_project_repository),
        )
        .route(
            "/api/project-repositories/{id}/base-branch",
            post(set_project_repository_base_branch),
        )
        .route(
            "/api/project-repositories/{id}/refresh",
            post(refresh_project_repository),
        )
        .route(
            "/api/project-repositories/{id}/reattach",
            post(reattach_project_repository),
        )
        .route(
            "/api/project-repositories/{id}/git-history",
            get(get_project_repository_git_history),
        )
        .route(
            "/api/project-repositories/{id}/compare",
            post(compare_project_repository_commits),
        )
        .route(
            "/api/project-repositories/{id}/git-status",
            get(get_project_repository_git_status),
        )
        .route(
            "/api/project-repositories/{id}/git-diff",
            post(project_repository_git_diff),
        )
        .route(
            "/api/project-repositories/{id}/git/stage",
            post(project_repository_stage),
        )
        .route(
            "/api/project-repositories/{id}/git/unstage",
            post(project_repository_unstage),
        )
        .route(
            "/api/project-repositories/{id}/git/commit",
            post(project_repository_commit),
        )
        .route(
            "/api/project-repositories/{id}/git/revert",
            post(project_repository_revert_commit),
        )
        .route(
            "/api/project-repositories/{id}/git/reset",
            post(project_repository_reset_commit),
        )
        .route(
            "/api/project-repositories/{id}/git/pull",
            post(pull_project_repository),
        )
        .route(
            "/api/project-repositories/{id}/git/push",
            post(push_project_repository),
        )
        .route(
            "/api/project-repositories/{id}/branches",
            get(list_directory_branches).delete(delete_directory_branch),
        )
        .route(
            "/api/project-repositories/{id}/checkout",
            post(checkout_directory_branch),
        )
        .route(
            "/api/project-repositories/{id}/worktrees",
            axum::routing::delete(delete_worktree),
        )
        .route(
            "/api/project-repositories/{id}/worktrees/delete-precheck",
            post(precheck_delete_worktree),
        )
        .route(
            "/api/project-repositories/{id}/worktrees/delete-status",
            get(delete_worktree_status),
        )
        .route("/api/projects/{id}/workspaces", post(create_workspace))
        .route("/api/workspaces/{id}/forks", post(create_fork))
        .route(
            "/api/workspaces/{id}",
            get(get_workspace)
                .patch(update_workspace)
                .delete(delete_workspace),
        )
        .route("/api/workspaces/{id}/resync", post(resync_workspace))
        .route(
            "/api/workspaces/{id}/git/pull-all",
            post(pull_all_workspace),
        )
        .route(
            "/api/workspaces/{id}/git/push-all",
            post(push_all_workspace),
        )
        .route(
            "/api/workspace-repositories/{id}/git-history",
            get(get_workspace_repository_git_history),
        )
        .route(
            "/api/workspace-repositories/{id}/compare",
            post(compare_workspace_repository_commits),
        )
        .route(
            "/api/workspace-repositories/{id}/git-status",
            get(get_workspace_repository_git_status),
        )
        .route(
            "/api/workspace-repositories/{id}/git-diff",
            post(workspace_repository_git_diff),
        )
        .route(
            "/api/workspace-repositories/{id}/git/stage",
            post(workspace_repository_stage),
        )
        .route(
            "/api/workspace-repositories/{id}/git/unstage",
            post(workspace_repository_unstage),
        )
        .route(
            "/api/workspace-repositories/{id}/git/commit",
            post(workspace_repository_commit),
        )
        .route(
            "/api/workspace-repositories/{id}/git/revert",
            post(workspace_repository_revert_commit),
        )
        .route(
            "/api/workspace-repositories/{id}/git/reset",
            post(workspace_repository_reset_commit),
        )
        .route(
            "/api/workspace-repositories/{id}",
            patch(update_workspace_repository),
        )
        .route(
            "/api/workspace-repositories/{id}/git/pull",
            post(pull_workspace_repository),
        )
        .route(
            "/api/workspace-repositories/{id}/git/push",
            post(push_workspace_repository),
        )
        .route(
            "/api/workspace-repositories/{id}/delivery-preflight",
            post(create_workspace_repository_preflight),
        )
        .route(
            "/api/workspace-repositories/{id}/parent-operation",
            get(get_parent_operation_preview).post(start_parent_operation),
        )
        .route("/api/parent-operations/{id}", get(get_parent_operation))
        .route(
            "/api/parent-operations/{id}/resolve-with-codex",
            post(resolve_parent_operation_with_codex),
        )
        .route(
            "/api/parent-operations/{id}/abort",
            post(abort_parent_operation),
        )
        .route(
            "/api/parent-operations/{id}/undo",
            post(undo_parent_operation),
        )
        .route(
            "/api/workspace-repositories/{id}/finish",
            post(finish_workspace_repository),
        )
        .route("/api/workspaces/{id}/archive", post(archive_workspace))
        .route("/api/workspaces/{id}/reveal", post(reveal_workspace))
        .route(
            "/api/workspaces/{id}/sessions",
            get(list_sessions).post(create_session),
        )
        .route(
            "/api/workspaces/{id}/sessions/order",
            patch(reorder_sessions),
        )
        .route("/api/workspaces/{id}/todos", post(create_todo))
        .route("/api/todos/{id}", patch(update_todo).delete(delete_todo))
        .route("/api/todos/{id}/fork", post(create_todo_fork))
        .route(
            "/api/sessions/{id}",
            get(get_session)
                .patch(update_session)
                .delete(delete_session),
        )
        .route("/api/sessions/{id}/stop", post(stop_session))
        .route("/api/sessions/{id}/restart", post(restart_session))
        .route("/api/sessions/{id}/close", post(close_session))
        .route("/api/sessions/{id}/open", post(open_session))
        .route("/api/sessions/{id}/terminal", get(terminal_socket))
        .route("/api/keymap", get(keymap::get).patch(keymap::update))
        .route("/api/settings", get(get_settings).patch(update_settings))
        .fallback(route_not_found)
        .method_not_allowed_fallback(method_not_allowed)
        .layer(cors)
        .layer(axum::middleware::from_fn(crate::request_context::correlate))
        .with_state(state)
}

async fn runtime_revision(State(state): State<AppState>) -> Json<Value> {
    Json(json!(state.runtime.cursor()))
}

async fn runtime_events(
    State(state): State<AppState>,
) -> Sse<impl futures_util::Stream<Item = std::result::Result<Event, Infallible>>> {
    // Subscribe before reading the cursor so a publish racing with connection
    // setup is either represented by the sync cursor or queued on the receiver.
    let (receiver, initial_cursor) = state.runtime.subscribe_with_cursor();
    let runtime = state.runtime.clone();
    let events = stream::unfold(
        (receiver, runtime, Some(initial_cursor)),
        |(mut receiver, runtime, initial_cursor)| async move {
            if let Some(cursor) = initial_cursor {
                let payload = json!(cursor);
                return Some((
                    Ok(Event::default()
                        .event("runtime.sync")
                        .data(payload.to_string())),
                    (receiver, runtime, None),
                ));
            }
            match receiver.recv().await {
                Ok(change) => {
                    let payload = serde_json::to_string(&change).unwrap_or_default();
                    Some((
                        Ok(Event::default().event("runtime.changed").data(payload)),
                        (receiver, runtime, None),
                    ))
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    let payload = json!(runtime.cursor());
                    Some((
                        Ok(Event::default()
                            .event("runtime.sync")
                            .data(payload.to_string())),
                        (receiver, runtime, None),
                    ))
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => None,
            }
        },
    );
    Sse::new(events).keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
}

async fn route_not_found() -> AppError {
    AppError::api(StatusCode::NOT_FOUND, "ROUTE_NOT_FOUND", "route not found")
}

async fn method_not_allowed() -> AppError {
    AppError::api(
        StatusCode::METHOD_NOT_ALLOWED,
        "METHOD_NOT_ALLOWED",
        "method not allowed",
    )
}

async fn list_background_processes(
    State(state): State<AppState>,
) -> Json<Vec<crate::terminal::TreefoldProcessView>> {
    Json(state.terminals.process_snapshot().await)
}

mod agent;
mod codex_identity;
mod delivery;
mod fork;
#[path = "server/git.rs"]
mod git_routes;
mod hosting;
mod keymap;
mod parent_operation;
mod session;
#[cfg(test)]
mod tests;
mod verification;
mod workspace;
mod worktree_names;

use agent::*;
use codex_identity::*;
use delivery::*;
use fork::*;
use git_routes::*;
use hosting::*;
use parent_operation::*;
use session::*;
use verification::*;
use workspace::*;
