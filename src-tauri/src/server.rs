#![allow(dead_code)] // Legacy helpers remain only for shared delivery state-machine coverage.

use std::{
    collections::{HashMap, HashSet},
    env,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::Command,
};

use axum::{
    Json, Router,
    extract::{
        Path as AxumPath, Query, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::{HeaderMap, Method, StatusCode},
    response::IntoResponse,
    routing::{get, patch, post},
};
use futures_util::{SinkExt, StreamExt};
use moka::future::Cache;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::sync::OnceLock;
use tower_http::cors::CorsLayer;
use uuid::Uuid;

use crate::{
    error::{ApiJson, AppError, Result},
    git,
    model::*,
    settings::{SettingsPatch, SettingsStore},
    store::{ParentOperationUpdate, Store, now},
    terminal::TerminalManager,
};

#[derive(Clone)]
pub struct AppState {
    pub store: Store,
    pub settings: SettingsStore,
    pub terminals: TerminalManager,
}

static PROJECT_WORKTREES: OnceLock<Cache<String, Vec<GitWorktree>>> = OnceLock::new();
static LOCATION_OBSERVATIONS: OnceLock<Cache<String, ProjectLocation>> = OnceLock::new();

fn project_worktrees_cache() -> &'static Cache<String, Vec<GitWorktree>> {
    PROJECT_WORKTREES.get_or_init(|| {
        Cache::builder()
            .max_capacity(256)
            .time_to_live(std::time::Duration::from_secs(10))
            .build()
    })
}

fn location_observations_cache() -> &'static Cache<String, ProjectLocation> {
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
    state.terminals.connect_existing().await;
    reconcile_daemon_sessions(&state).await?;
    let bridge_state = state.clone();
    tokio::spawn(async move {
        loop {
            match process_events.recv().await {
                Ok(event) => {
                    if let Err(error) = reconcile_process_event(&bridge_state, event) {
                        log::error!("failed to reconcile amux process event: {error}");
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    let _ = reconcile_daemon_sessions(&bridge_state).await;
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
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
        .allow_headers(tower_http::cors::Any);
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
        .route("/api/v1/agent/todos/{id}/claim", post(agent_claim_todo))
        .route("/api/v1/agent/todos/{id}/release", post(agent_release_todo))
        .route("/api/v1/agent/todos/{id}/done", post(agent_done_todo))
        .route("/api/v1/agent/todos/{id}/block", post(agent_block_todo))
        .route("/api/system", get(system_status))
        .route("/api/amux", get(amux_status))
        .route("/api/amux/stop", post(stop_amux))
        .route("/api/processes", get(list_background_processes))
        .route("/api/projects", get(list_projects).post(create_project))
        .route("/api/projects/summary", get(list_project_summaries))
        .route("/api/sidebar", get(get_sidebar))
        .route(
            "/api/projects/{id}",
            get(get_project)
                .patch(update_project)
                .delete(delete_project),
        )
        .route("/api/projects/{id}/git/pull-all", post(pull_all_project))
        .route("/api/projects/{id}/git/push-all", post(push_all_project))
        .route(
            "/api/projects/{id}/sessions",
            get(list_project_sessions).post(create_project_session),
        )
        .route("/api/projects/{id}/reveal", post(reveal_project))
        .route(
            "/api/projects/{id}/reconciliation",
            get(get_project_reconciliation).post(repair_project),
        )
        .route(
            "/api/projects/{id}/directories",
            get(list_project_directories).post(create_directory),
        )
        .route(
            "/api/project-directories/inspect",
            post(inspect_project_location),
        )
        .route(
            "/api/project-directories/{id}",
            get(get_project_directory)
                .patch(update_directory)
                .delete(delete_project_location),
        )
        .route(
            "/api/project-directories/{id}/refresh",
            post(refresh_project_location),
        )
        .route(
            "/api/projects/{id}/repositories",
            get(list_project_repositories),
        )
        .route(
            "/api/project-repositories/{id}",
            get(get_project_repository)
                .patch(update_project_repository)
                .delete(delete_project_repository),
        )
        .route(
            "/api/project-repositories/{id}/refresh",
            post(refresh_project_repository),
        )
        .route(
            "/api/project-repositories/{id}/reattach",
            post(reattach_project_location),
        )
        .route(
            "/api/project-repositories/{id}/git-history",
            get(get_project_location_git_history),
        )
        .route(
            "/api/project-repositories/{id}/compare",
            post(compare_project_location_commits),
        )
        .route(
            "/api/project-repositories/{id}/git/pull",
            post(pull_project_location),
        )
        .route(
            "/api/project-repositories/{id}/git/push",
            post(push_project_location),
        )
        .route(
            "/api/project-repositories/{id}/branches",
            get(list_directory_branches),
        )
        .route(
            "/api/project-repositories/{id}/checkout",
            post(checkout_directory_branch),
        )
        .route(
            "/api/project-repositories/{id}/worktrees",
            axum::routing::delete(delete_worktree),
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
            get(get_workspace_location_git_history),
        )
        .route(
            "/api/workspace-repositories/{id}/compare",
            post(compare_workspace_location_commits),
        )
        .route(
            "/api/workspace-repositories/{id}",
            patch(update_workspace_location),
        )
        .route(
            "/api/workspace-repositories/{id}/git/pull",
            post(pull_workspace_location),
        )
        .route(
            "/api/workspace-repositories/{id}/git/push",
            post(push_workspace_location),
        )
        .route(
            "/api/workspace-repositories/{id}/delivery-preflight",
            post(create_workspace_location_preflight),
        )
        .route(
            "/api/workspace-repositories/{id}/rebase",
            get(get_workspace_location_rebase).post(update_workspace_location_rebase),
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
            "/api/workspace-repositories/{id}/reset",
            get(get_workspace_location_reset).post(reset_workspace_location),
        )
        .route(
            "/api/workspace-repositories/{id}/reset/restore",
            post(restore_workspace_location_reset),
        )
        .route(
            "/api/workspace-repositories/{id}/finish",
            post(finish_workspace_location),
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
        .route("/api/todos/{id}", patch(update_todo))
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
        .route("/api/settings", get(get_settings).patch(update_settings))
        .fallback(route_not_found)
        .method_not_allowed_fallback(method_not_allowed)
        .layer(cors)
        .with_state(state)
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
mod delivery;
mod fork;
#[path = "server/git.rs"]
mod git_routes;
mod hosting;
mod parent_operation;
mod session;
#[cfg(test)]
mod tests;
mod verification;
mod workspace;

use agent::*;
use delivery::*;
use fork::*;
use git_routes::*;
use hosting::*;
use parent_operation::*;
use session::*;
use verification::*;
use workspace::*;
