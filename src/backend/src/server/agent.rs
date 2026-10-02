use super::*;

pub(super) async fn health() -> Json<Value> {
    Json(json!({"status":"ok","time":now()}))
}

pub(super) async fn system_status(State(state): State<AppState>) -> Result<Json<Value>> {
    let codex = command_output(Path::new("."), "codex", &["--version"]).ok();
    Ok(Json(json!({
        "platform":std::env::consts::OS,
        "treefold_home":state.settings.treefold_home().to_string_lossy(),
        "codex_available":codex.is_some(), "codex_version":codex
    })))
}

pub(super) async fn reveal_runtime_logs(State(state): State<AppState>) -> Result<StatusCode> {
    let logs = state.settings.treefold_home().join("logs");
    reveal_in_file_manager(&logs.to_string_lossy())?;
    Ok(StatusCode::NO_CONTENT)
}

pub(super) async fn amux_status(
    State(state): State<AppState>,
) -> Json<crate::terminal::DaemonResourceStatus> {
    Json(state.terminals.daemon_status().await)
}

pub(super) async fn stop_amux(State(state): State<AppState>) -> Result<StatusCode> {
    state.terminals.stop_daemon().await?;
    state.store.stop_active_sessions().await?;
    capture_pending_codex_sessions(&state).await?;
    state.runtime.publish_daemon_stopped();
    Ok(StatusCode::NO_CONTENT)
}

pub(super) async fn agent_integration_status(
    State(state): State<AppState>,
) -> Result<Json<crate::integration::IntegrationStatus>> {
    Ok(Json(state.integration.status()?))
}

pub(super) async fn sync_agent_integration(
    State(state): State<AppState>,
) -> Result<Json<crate::integration::IntegrationStatus>> {
    match state.integration.sync() {
        Ok(status) => Ok(Json(status)),
        Err(crate::integration::IntegrationError::Unavailable(path)) => Err(AppError::api(
            StatusCode::SERVICE_UNAVAILABLE,
            "AGENT_INTEGRATION_UNAVAILABLE",
            format!("Bundled resource is missing: {}", path.display()),
        )),
        Err(crate::integration::IntegrationError::Other(error)) => Err(error.into()),
    }
}

pub(super) async fn uninstall_agent_integration(
    State(state): State<AppState>,
) -> Result<Json<crate::integration::IntegrationStatus>> {
    Ok(Json(state.integration.uninstall()?))
}

pub(super) struct AgentContext {
    session: Session,
    workspace: Workspace,
}

pub(super) async fn agent_context(state: &AppState, headers: &HeaderMap) -> Result<AgentContext> {
    let token = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::api(
                StatusCode::UNAUTHORIZED,
                "AGENT_AUTH_REQUIRED",
                "missing Treefold Session capability",
            )
        })?;
    // The pre-release local API uses the random Session ID as its loopback-only
    // capability. A future authenticated UI API can replace this with a keychain-
    // backed token without changing the CLI contract.
    let session = state.store.session(token).await.map_err(|_| {
        AppError::api(
            StatusCode::UNAUTHORIZED,
            "AGENT_AUTH_INVALID",
            "invalid or expired Treefold Session capability",
        )
    })?;
    let workspace = state.store.workspace(&session.workspace_id).await?;
    if workspace.status != "active" {
        return Err(AppError::api(
            StatusCode::FORBIDDEN,
            "WORKSPACE_ARCHIVED",
            "the Session Workspace is archived",
        ));
    }
    Ok(AgentContext { session, workspace })
}

pub(super) async fn agent_owned_todos(state: &AppState, workspace_id: &str) -> Result<Vec<Todo>> {
    let workspace = state.store.workspace(workspace_id).await?;
    if workspace.kind == "base" {
        return Ok(Vec::new());
    }
    if workspace.kind == "fork" {
        return Ok(state
            .store
            .todo_for_fork(workspace_id)
            .await?
            .into_iter()
            .collect());
    }
    state.store.todos(workspace_id).await
}

pub(super) async fn agent_todo(state: &AppState, context: &AgentContext, id: &str) -> Result<Todo> {
    if context.workspace.kind == "base" {
        return Err(AppError::api(
            StatusCode::FORBIDDEN,
            "PROJECT_SESSION_HAS_NO_TODOS",
            "Project Sessions do not own development Todos",
        ));
    }
    let todo = state.store.todo(id).await?;
    let visible = if context.workspace.kind == "fork" {
        todo.fork_id.as_deref() == Some(context.workspace.id.as_str())
    } else {
        todo.workspace_id == context.workspace.id
    };
    if !visible {
        return Err(AppError::api(
            StatusCode::NOT_FOUND,
            "TODO_NOT_FOUND",
            "Todo does not belong to the current Workspace",
        ));
    }
    Ok(todo)
}

pub(super) async fn agent_current(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>> {
    let context = agent_context(&state, &headers).await?;
    Ok(Json(
        treefold_runtime_snapshot(&state, &context.session, &context.workspace).await?,
    ))
}

pub(super) async fn agent_list_todos(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<Todo>>> {
    let context = agent_context(&state, &headers).await?;
    Ok(Json(
        agent_owned_todos(&state, &context.workspace.id).await?,
    ))
}

pub(super) async fn agent_get_todo(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Todo>> {
    let context = agent_context(&state, &headers).await?;
    Ok(Json(agent_todo(&state, &context, &id).await?))
}

#[derive(Deserialize)]
pub(super) struct AgentCreateTodo {
    content: String,
}

pub(super) async fn agent_create_todo(
    State(state): State<AppState>,
    headers: HeaderMap,
    ApiJson(input): ApiJson<AgentCreateTodo>,
) -> Result<(StatusCode, Json<Todo>)> {
    let context = agent_context(&state, &headers).await?;
    if context.workspace.kind == "base" {
        return Err(AppError::api(
            StatusCode::FORBIDDEN,
            "PROJECT_SESSION_HAS_NO_TODOS",
            "Project Sessions do not own development Todos",
        ));
    }
    if input.content.trim().is_empty() {
        return Err(AppError::BadRequest("content is required".into()));
    }
    let owner_id = context
        .workspace
        .parent_workspace_id
        .clone()
        .unwrap_or(context.workspace.id);
    let timestamp = now();
    let todo = Todo {
        id: new_id(),
        workspace_id: owner_id,
        content: input.content.trim().into(),
        status: "pending".into(),
        fork_id: None,
        blocked_reason: None,
        created_at: timestamp.clone(),
        updated_at: timestamp,
    };
    state.store.create_todo(&todo).await?;
    Ok((StatusCode::CREATED, Json(todo)))
}

#[derive(Deserialize)]
pub(super) struct AgentEditTodo {
    content: Option<String>,
}

pub(super) async fn agent_edit_todo(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<AgentEditTodo>,
) -> Result<Json<Todo>> {
    let context = agent_context(&state, &headers).await?;
    agent_todo(&state, &context, &id).await?;
    let content = trimmed(input.content);
    if content.as_deref().is_some_and(str::is_empty) {
        return Err(AppError::BadRequest("content must not be empty".into()));
    }
    if content.is_none() {
        return Err(AppError::BadRequest("content is required".into()));
    }
    state.store.edit_todo(&id, content.as_deref()).await?;
    Ok(Json(state.store.todo(&id).await?))
}

pub(super) async fn agent_delete_todo(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Value>> {
    let context = agent_context(&state, &headers).await?;
    let todo = agent_todo(&state, &context, &id).await?;
    let fork_active = if let Some(fork_id) = todo.fork_id.as_deref() {
        state
            .store
            .workspace(fork_id)
            .await
            .is_ok_and(|fork| fork.status == "active")
    } else {
        false
    };
    if todo.status == "in_progress" || fork_active {
        return Err(AppError::api(
            StatusCode::CONFLICT,
            "TODO_FORK_ACTIVE",
            "archive or finish the active Fork before deleting this Todo",
        ));
    }
    state.store.delete_todo(&id).await?;
    Ok(Json(json!({"removed":true, "id":id})))
}

#[derive(Deserialize)]
pub(super) struct AgentBlockTodo {
    reason: String,
}

pub(super) async fn agent_block_todo(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<AgentBlockTodo>,
) -> Result<Json<Todo>> {
    let context = agent_context(&state, &headers).await?;
    agent_todo(&state, &context, &id).await?;
    if input.reason.trim().is_empty() {
        return Err(AppError::BadRequest("reason is required".into()));
    }
    state.store.block_todo(&id, input.reason.trim()).await?;
    Ok(Json(state.store.todo(&id).await?))
}
