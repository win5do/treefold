async fn health() -> Json<Value> {
    Json(json!({"status":"ok","time":now()}))
}

async fn system_status() -> Result<Json<Value>> {
    let codex = command_output(Path::new("."), "codex", &["--version"]).ok();
    Ok(Json(json!({
        "platform":"darwin", "codex_available":codex.is_some(), "codex_version":codex,
        "backend":"rust", "terminal_runtime":"portable-pty"
    })))
}

struct AgentContext {
    session: Session,
    workspace: Workspace,
}

fn agent_context(state: &AppState, headers: &HeaderMap) -> Result<AgentContext> {
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
    let session = state.store.session(token).map_err(|_| {
        AppError::api(
            StatusCode::UNAUTHORIZED,
            "AGENT_AUTH_INVALID",
            "invalid or expired Treefold Session capability",
        )
    })?;
    let workspace = state.store.workspace(&session.workspace_id)?;
    if workspace.status != "active" {
        return Err(AppError::api(
            StatusCode::FORBIDDEN,
            "WORKSPACE_ARCHIVED",
            "the Session Workspace is archived",
        ));
    }
    Ok(AgentContext { session, workspace })
}

fn agent_owned_todos(state: &AppState, workspace_id: &str) -> Result<Vec<Todo>> {
    let workspace = state.store.workspace(workspace_id)?;
    if workspace.kind == "base" {
        return Ok(Vec::new());
    }
    state.store.todos(workspace_id)
}

fn agent_todo(state: &AppState, context: &AgentContext, id: &str) -> Result<Todo> {
    if context.workspace.kind == "base" {
        return Err(AppError::api(
            StatusCode::FORBIDDEN,
            "PROJECT_SESSION_HAS_NO_TODOS",
            "Project Sessions do not own development Todos",
        ));
    }
    let todo = state.store.todo(id)?;
    if todo.workspace_id != context.workspace.id {
        return Err(AppError::api(
            StatusCode::NOT_FOUND,
            "TODO_NOT_FOUND",
            "Todo does not belong to the current Workspace",
        ));
    }
    Ok(todo)
}

fn ensure_todo_not_owned_by_another_session(context: &AgentContext, todo: &Todo) -> Result<()> {
    if todo
        .session_id
        .as_deref()
        .is_some_and(|session_id| session_id != context.session.id)
    {
        return Err(AppError::api(
            StatusCode::CONFLICT,
            "TODO_ASSIGNED_TO_ANOTHER_SESSION",
            "Todo is assigned to another Session",
        ));
    }
    Ok(())
}

async fn agent_current(State(state): State<AppState>, headers: HeaderMap) -> Result<Json<Value>> {
    let context = agent_context(&state, &headers)?;
    Ok(Json(treefold_runtime_snapshot(
        &state,
        &context.session,
        &context.workspace,
    )?))
}

async fn agent_list_todos(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<Todo>>> {
    let context = agent_context(&state, &headers)?;
    Ok(Json(agent_owned_todos(&state, &context.workspace.id)?))
}

async fn agent_get_todo(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Todo>> {
    let context = agent_context(&state, &headers)?;
    Ok(Json(agent_todo(&state, &context, &id)?))
}

#[derive(Deserialize)]
struct AgentCreateTodo {
    title: String,
    description: Option<String>,
}

async fn agent_create_todo(
    State(state): State<AppState>,
    headers: HeaderMap,
    ApiJson(input): ApiJson<AgentCreateTodo>,
) -> Result<(StatusCode, Json<Todo>)> {
    let context = agent_context(&state, &headers)?;
    if context.workspace.kind == "base" {
        return Err(AppError::api(
            StatusCode::FORBIDDEN,
            "PROJECT_SESSION_HAS_NO_TODOS",
            "Project Sessions do not own development Todos",
        ));
    }
    if input.title.trim().is_empty() {
        return Err(AppError::BadRequest("title is required".into()));
    }
    let timestamp = now();
    let todo = Todo {
        id: id(),
        workspace_id: context.workspace.id,
        title: input.title.trim().into(),
        description: trimmed(input.description).unwrap_or_default(),
        status: "pending".into(),
        session_id: None,
        blocked_reason: None,
        created_at: timestamp.clone(),
        updated_at: timestamp,
    };
    state.store.create_todo(&todo)?;
    Ok((StatusCode::CREATED, Json(todo)))
}

#[derive(Deserialize)]
struct AgentEditTodo {
    title: Option<String>,
    description: Option<String>,
}

async fn agent_edit_todo(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<AgentEditTodo>,
) -> Result<Json<Todo>> {
    let context = agent_context(&state, &headers)?;
    agent_todo(&state, &context, &id)?;
    let title = trimmed(input.title);
    let description = trimmed(input.description);
    if title.as_deref().is_some_and(str::is_empty) {
        return Err(AppError::BadRequest("title must not be empty".into()));
    }
    if title.is_none() && description.is_none() {
        return Err(AppError::BadRequest(
            "title or description is required".into(),
        ));
    }
    state
        .store
        .edit_todo(&id, title.as_deref(), description.as_deref())?;
    Ok(Json(state.store.todo(&id)?))
}

async fn agent_delete_todo(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Value>> {
    let context = agent_context(&state, &headers)?;
    agent_todo(&state, &context, &id)?;
    state.store.delete_todo(&id)?;
    Ok(Json(json!({"removed":true, "id":id})))
}

async fn agent_claim_todo(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Todo>> {
    let context = agent_context(&state, &headers)?;
    let todo = agent_todo(&state, &context, &id)?;
    ensure_todo_not_owned_by_another_session(&context, &todo)?;
    if !state.store.claim_todo(&id, &context.session.id)? {
        return Err(AppError::api(
            StatusCode::CONFLICT,
            "TODO_ALREADY_CLAIMED",
            "Todo is not pending or is assigned to another Session",
        ));
    }
    Ok(Json(state.store.todo(&id)?))
}

async fn agent_release_todo(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Todo>> {
    let context = agent_context(&state, &headers)?;
    let todo = agent_todo(&state, &context, &id)?;
    if todo.session_id.as_deref() != Some(context.session.id.as_str()) {
        return Err(AppError::api(
            StatusCode::CONFLICT,
            "TODO_NOT_ASSIGNED_TO_SESSION",
            "Todo is not assigned to the current Session",
        ));
    }
    state.store.update_todo(&id, "pending", None)?;
    Ok(Json(state.store.todo(&id)?))
}

async fn agent_done_todo(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Todo>> {
    let context = agent_context(&state, &headers)?;
    let todo = agent_todo(&state, &context, &id)?;
    ensure_todo_not_owned_by_another_session(&context, &todo)?;
    state
        .store
        .update_todo(&id, "done", Some(&context.session.id))?;
    Ok(Json(state.store.todo(&id)?))
}

#[derive(Deserialize)]
struct AgentBlockTodo {
    reason: String,
}

async fn agent_block_todo(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<AgentBlockTodo>,
) -> Result<Json<Todo>> {
    let context = agent_context(&state, &headers)?;
    let todo = agent_todo(&state, &context, &id)?;
    ensure_todo_not_owned_by_another_session(&context, &todo)?;
    if input.reason.trim().is_empty() {
        return Err(AppError::BadRequest("reason is required".into()));
    }
    state
        .store
        .block_todo(&id, &context.session.id, input.reason.trim())?;
    Ok(Json(state.store.todo(&id)?))
}

