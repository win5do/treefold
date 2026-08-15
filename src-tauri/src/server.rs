use std::{
    collections::{HashMap, HashSet},
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::Command,
};

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path as AxumPath, Query, State,
    },
    http::{HeaderMap, Method, StatusCode},
    response::IntoResponse,
    routing::{get, patch, post},
    Json, Router,
};
use futures_util::{SinkExt, StreamExt};
use moka::future::Cache;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::LazyLock;
use tower_http::cors::CorsLayer;
use uuid::Uuid;

use crate::{
    error::{ApiJson, AppError, Result},
    git,
    model::*,
    settings::{SettingsPatch, SettingsStore},
    store::{now, Store},
    terminal::TerminalManager,
};

#[derive(Clone)]
pub struct AppState {
    pub store: Store,
    pub settings: SettingsStore,
    pub terminals: TerminalManager,
}

static PROJECT_WORKTREES: LazyLock<Cache<String, Vec<GitWorktree>>> = LazyLock::new(|| {
    Cache::builder()
        .max_capacity(256)
        .time_to_live(std::time::Duration::from_secs(10))
        .build()
});
static LOCATION_OBSERVATIONS: LazyLock<Cache<String, ProjectLocation>> = LazyLock::new(|| {
    Cache::builder()
        .max_capacity(256)
        .time_to_live(std::time::Duration::from_secs(10))
        .build()
});

pub async fn serve(state: AppState) -> anyhow::Result<()> {
    let app = app(state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:7331").await?;
    log::info!("Rust API listening on http://127.0.0.1:7331");
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
            "/api/projects/{id}/git-history",
            get(get_project_git_history),
        )
        .route("/api/projects/{id}/git/pull", post(pull_project))
        .route("/api/projects/{id}/git/push", post(push_project))
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
        .route("/api/projects/{id}/directories", post(create_directory))
        .route(
            "/api/projects/{id}/locations",
            get(list_project_locations).post(create_directory),
        )
        .route(
            "/api/project-locations/inspect",
            post(inspect_project_location),
        )
        .route("/api/project-directories/{id}", patch(update_directory))
        .route(
            "/api/project-locations/{id}",
            get(get_project_location)
                .patch(update_directory)
                .delete(delete_project_location),
        )
        .route(
            "/api/project-locations/{id}/refresh",
            post(refresh_project_location),
        )
        .route(
            "/api/project-locations/{id}/reattach",
            post(reattach_project_location),
        )
        .route(
            "/api/project-locations/{id}/git-history",
            get(get_project_location_git_history),
        )
        .route(
            "/api/project-locations/{id}/git/pull",
            post(pull_project_location),
        )
        .route(
            "/api/project-locations/{id}/git/push",
            post(push_project_location),
        )
        .route(
            "/api/project-directories/{id}/branches",
            get(list_directory_branches),
        )
        .route(
            "/api/project-directories/{id}/checkout",
            post(checkout_directory_branch),
        )
        .route(
            "/api/project-directories/{id}/worktrees",
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
        .route(
            "/api/workspaces/{id}/git-history",
            get(get_workspace_git_history),
        )
        .route("/api/workspaces/{id}/git/pull", post(pull_workspace))
        .route("/api/workspaces/{id}/git/push", post(push_workspace))
        .route(
            "/api/workspaces/{id}/git/pull-all",
            post(pull_all_workspace),
        )
        .route(
            "/api/workspaces/{id}/git/push-all",
            post(push_all_workspace),
        )
        .route(
            "/api/workspace-locations/{id}/git-history",
            get(get_workspace_location_git_history),
        )
        .route(
            "/api/workspace-locations/{id}",
            patch(update_workspace_location),
        )
        .route(
            "/api/workspace-locations/{id}/git/pull",
            post(pull_workspace_location),
        )
        .route(
            "/api/workspace-locations/{id}/git/push",
            post(push_workspace_location),
        )
        .route(
            "/api/workspace-locations/{id}/delivery-preflight",
            post(create_workspace_location_preflight),
        )
        .route(
            "/api/workspace-locations/{id}/rebase",
            get(get_workspace_location_rebase).post(update_workspace_location_rebase),
        )
        .route(
            "/api/workspace-locations/{id}/reset",
            get(get_workspace_location_reset).post(reset_workspace_location),
        )
        .route(
            "/api/workspace-locations/{id}/reset/restore",
            post(restore_workspace_location_reset),
        )
        .route(
            "/api/workspace-locations/{id}/finish",
            post(finish_workspace_location),
        )
        .route("/api/workspaces/{id}/archive", post(archive_workspace))
        .route("/api/workspaces/{id}/reveal", post(reveal_workspace))
        .route(
            "/api/workspaces/{id}/git-operations",
            get(get_git_operations),
        )
        .route(
            "/api/workspaces/{id}/rebase",
            get(get_rebase_status).post(update_rebase),
        )
        .route(
            "/api/workspaces/{id}/delivery-preflight",
            post(create_delivery_preflight),
        )
        .route(
            "/api/workspaces/{id}/reset",
            get(get_reset_status).post(reset_workspace),
        )
        .route(
            "/api/workspaces/{id}/reset/restore",
            post(restore_workspace_reset),
        )
        .route("/api/workspaces/{id}/finish", post(finish_workspace))
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

include!("server/agent.rs");
include!("server/workspace.rs");
include!("server/fork.rs");
include!("server/git.rs");
include!("server/delivery.rs");
include!("server/verification.rs");
include!("server/session.rs");
include!("server/hosting.rs");
include!("server/tests.rs");
