#[derive(Deserialize)]
struct CreateSession {
    name: Option<String>,
    kind: Option<String>,
    project_directory_id: Option<String>,
    initial_prompt: Option<String>,
}

async fn create_project_session(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    ApiJson(input): ApiJson<CreateSession>,
) -> Result<(StatusCode, Json<Session>)> {
    let workspace = sync_project_session_workspace(&state, &project_id)?;
    create_session_for_workspace(&state, workspace, input).await
}

async fn list_project_sessions(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
) -> Result<Json<Vec<Session>>> {
    state.store.project(&project_id)?;
    let sessions = state.store.project_sessions(&project_id)?;
    Ok(Json(refresh_session_records(&state, sessions).await?))
}

fn sync_project_session_workspace(state: &AppState, project_id: &str) -> Result<Workspace> {
    let project = state.store.project(project_id)?;
    if project.status != "active" {
        return Err(AppError::BadRequest(
            "cannot create a Session in an archived Project".into(),
        ));
    }
    let mut project_locations = state.store.directories(project_id)?;
    if project_locations.is_empty() {
        return Err(AppError::BadRequest(
            "Project has no location for a Session".into(),
        ));
    }
    for location in &mut project_locations {
        refresh_location_observation(location)?;
    }
    let timestamp = now();
    let workspace = Workspace {
        id: format!("project-base-{project_id}"),
        project_id: project_id.into(),
        name: format!("{} · Project Sessions", project.name),
        description: "Sessions that operate directly in Project locations".into(),
        status: "active".into(),
        kind: "base".into(),
        parent_workspace_id: None,
        runtime_id: format!("project-base-{project_id}"),
        runtime_name: format!(
            "treefold-project-{}",
            &project_id[..project_id.len().min(10)]
        ),
        created_at: timestamp.clone(),
        updated_at: timestamp.clone(),
        checkout_mode: "in_place".into(),
        project_directory_id: String::new(),
        worktree_id: None,
        checkout_path: String::new(),
        target_branch: String::new(),
        start_commit: String::new(),
        branch: String::new(),
        forked_from_commit: None,
        remote_name: None,
        remote_branch: None,
        branch_ownership: "user".into(),
        delivery_mode: "keep".into(),
        delivery_status: "not_applicable".into(),
        close_outcome: None,
        integrated_commit: None,
        closed_at: None,
    };
    let locations = project_locations
        .iter()
        .map(|location| project_session_location(&workspace.id, location, &timestamp))
        .collect::<Vec<_>>();
    state
        .store
        .sync_project_session_workspace(&workspace, &locations)?;
    state.store.workspace(&workspace.id)
}

fn project_session_location(
    workspace_id: &str,
    location: &ProjectLocation,
    timestamp: &str,
) -> WorkspaceLocation {
    let tracked_git = location.git_common_dir.is_some();
    WorkspaceLocation {
        id: format!("{workspace_id}-{}", location.id),
        workspace_id: workspace_id.into(),
        project_location_id: location.id.clone(),
        location_name: location.name.clone(),
        source_path: location.path.clone(),
        access_mode: if tracked_git {
            "read_write"
        } else {
            "read_only"
        }
        .into(),
        git_status: location.git_status.clone(),
        creation_error: None,
        worktree_id: None,
        checkout_path: tracked_git.then(|| location.path.clone()),
        branch: location.branch.clone(),
        base_branch: location.base_branch.clone(),
        start_commit: location.head_commit.clone(),
        forked_from_commit: None,
        remote_name: location.preferred_remote_name.clone(),
        remote_branch: None,
        branch_ownership: if tracked_git { "user" } else { "none" }.into(),
        delivery_mode: "keep".into(),
        delivery_status: "not_applicable".into(),
        close_outcome: None,
        integrated_commit: None,
        closed_at: None,
        created_at: timestamp.into(),
        updated_at: timestamp.into(),
    }
}

async fn create_session(
    State(state): State<AppState>,
    AxumPath(workspace_id): AxumPath<String>,
    ApiJson(input): ApiJson<CreateSession>,
) -> Result<(StatusCode, Json<Session>)> {
    let workspace = state.store.workspace(&workspace_id)?;
    create_session_for_workspace(&state, workspace, input).await
}

async fn list_sessions(
    State(state): State<AppState>,
    AxumPath(workspace_id): AxumPath<String>,
) -> Result<Json<Vec<Session>>> {
    state.store.workspace(&workspace_id)?;
    let sessions = state.store.sessions(&workspace_id)?;
    Ok(Json(refresh_session_records(&state, sessions).await?))
}

#[derive(Deserialize)]
struct ReorderSessions {
    session_ids: Vec<String>,
}

async fn reorder_sessions(
    State(state): State<AppState>,
    AxumPath(workspace_id): AxumPath<String>,
    ApiJson(input): ApiJson<ReorderSessions>,
) -> Result<Json<Vec<Session>>> {
    state.store.workspace(&workspace_id)?;
    let unique = input
        .session_ids
        .iter()
        .collect::<std::collections::HashSet<_>>();
    if unique.len() != input.session_ids.len() {
        return Err(AppError::BadRequest(
            "Session order contains duplicates".into(),
        ));
    }
    state
        .store
        .reorder_sessions(&workspace_id, &input.session_ids)?;
    Ok(Json(state.store.sessions(&workspace_id)?))
}

async fn create_session_for_workspace(
    state: &AppState,
    workspace: Workspace,
    input: CreateSession,
) -> Result<(StatusCode, Json<Session>)> {
    let workspace_id = workspace.id.clone();
    if workspace.status != "active" {
        return Err(AppError::BadRequest(
            "cannot create a session for an archived workspace".into(),
        ));
    }
    if state.store.project(&workspace.project_id)?.status != "active" {
        return Err(AppError::BadRequest(
            "cannot create a Session in an archived Project".into(),
        ));
    }
    let kind = trimmed(input.kind)
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "codex".into());
    if kind != "shell" && kind != "codex" {
        return Err(AppError::BadRequest("kind must be shell or codex".into()));
    }
    let project = state.store.project(&workspace.project_id)?;
    let locations = state.store.workspace_locations(&workspace.id)?;
    let selected_location = if let Some(directory_id) = input.project_directory_id.as_deref() {
        locations
            .iter()
            .find(|location| location.project_location_id == directory_id)
            .ok_or_else(|| {
                AppError::BadRequest("project directory does not belong to project".into())
            })?
    } else {
        locations
            .iter()
            .find(|location| {
                project.default_location_id.as_deref()
                    == Some(location.project_location_id.as_str())
                    && (location.access_mode == "read_only" || location.git_status == "ready")
            })
            .or_else(|| {
                locations.iter().find(|location| {
                    location.access_mode == "read_write" && location.git_status == "ready"
                })
            })
            .or_else(|| {
                (workspace.kind == "base")
                    .then(|| locations.first())
                    .flatten()
            })
            .ok_or_else(|| AppError::BadRequest("Workspace has no usable location".into()))?
    };
    if selected_location.access_mode == "read_write" && selected_location.git_status != "ready" {
        return Err(AppError::BadRequest(format!(
            "Workspace location '{}' is unavailable: {}",
            selected_location.location_name,
            selected_location
                .creation_error
                .as_deref()
                .unwrap_or(&selected_location.git_status)
        )));
    }
    if kind == "codex" && selected_location.access_mode != "read_write" {
        return Err(AppError::BadRequest(
            "Codex must start in an available Git location; non-Git locations are read-only context"
                .into(),
        ));
    }
    let cwd = selected_location
        .checkout_path
        .clone()
        .unwrap_or_else(|| selected_location.source_path.clone());
    if !Path::new(&cwd).is_dir() {
        return Err(AppError::BadRequest(format!(
            "Session location is unavailable: {cwd}"
        )));
    }
    let mut additional_directories = Vec::new();
    let mut read_only_contexts = Vec::new();
    let selected_name = Some(selected_location.location_name.clone());
    for location in &locations {
        let path = location
            .checkout_path
            .clone()
            .unwrap_or_else(|| location.source_path.clone());
        if location.access_mode == "read_write"
            && location.git_status == "ready"
            && normalized_path(&path) != normalized_path(&cwd)
        {
            additional_directories.push(path.clone());
        }
        if location.access_mode == "read_only" {
            read_only_contexts.push(path.clone());
        }
    }
    let codex_extra_args = if kind == "codex" {
        state.settings.load()?.agents.codex.extra_args
    } else {
        vec![]
    };
    let session_id = id();
    let timestamp = now();
    let mut name = trimmed(input.name)
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| kind.clone());
    if kind == "shell" && name == "shell" {
        if let Some(selected) = selected_name {
            name = format!("shell · {selected}");
        }
    }
    let mut session = Session {
        id: session_id.clone(),
        workspace_id,
        name,
        kind: kind.clone(),
        original_cwd: cwd.clone(),
        cwd,
        initial_prompt: trimmed(input.initial_prompt).unwrap_or_default(),
        codex_session_id: None,
        sidebar_visible: true,
        hidden_at: None,
        evicted_at: None,
        process_id: session_id.clone(),
        process_name: format!("{}-{}", kind, &session_id[..10]),
        status: "starting".into(),
        pid: 0,
        process_group_id: 0,
        exit_code: None,
        exit_signal: String::new(),
        command: vec![],
        launch_started_at: timestamp.clone(),
        last_attached_at: None,
        created_at: timestamp.clone(),
        updated_at: timestamp,
        additional_directories,
    };
    let developer_instructions = treefold_developer_instructions(state, &session, &workspace)?;
    state.store.create_session(&session)?;
    state
        .store
        .add_session_read_only_contexts(&session.id, &read_only_contexts)?;
    match state
        .terminals
        .spawn(
            &session,
            &workspace.project_id,
            developer_instructions.as_deref(),
            &codex_extra_args,
        )
        .await
    {
        Ok(process) => {
            session.process_id = process.id;
            session.process_name = process.name;
            session.pid = process.pid.into();
            session.process_group_id = process.process_group_id.into();
            session.command = process.command;
            session.status = "running".into();
            persist_amux_process(&state.store, &session.id, &session)?;
        }
        Err(error) => {
            let _ = state.store.delete_session(&session.id);
            return Err(AppError::BadRequest(error.to_string()));
        }
    }
    Ok((StatusCode::CREATED, Json(session)))
}

async fn get_session(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Session>> {
    let mut session = state.store.session(&id)?;
    if session.kind == "shell" && terminal_session_status(&session.status) {
        let _ = state.terminals.remove(&id).await;
        state.store.delete_session(&id)?;
        return Err(AppError::NotFound);
    }
    if let Ok(process) = state.terminals.inspect(&id).await {
        apply_amux_process(&mut session, process);
        if session.kind == "shell" && terminal_session_status(&session.status) {
            let _ = state.terminals.remove(&id).await;
            state.store.delete_session(&id)?;
            return Err(AppError::NotFound);
        }
        persist_amux_process(&state.store, &id, &session)?;
    }
    Ok(Json(session))
}

#[derive(Deserialize)]
struct UpdateSession {
    name: String,
}

async fn update_session(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<UpdateSession>,
) -> Result<Json<Session>> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("Session name cannot be empty".into()));
    }
    state.store.rename_session(&id, name)?;
    Ok(Json(state.store.session(&id)?))
}
async fn stop_session(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<StatusCode> {
    if state.terminals.is_running(&id).await {
        state
            .terminals
            .stop(&id)
            .await
            .map_err(|e| AppError::BadRequest(e.to_string()))?;
    }
    Ok(StatusCode::NO_CONTENT)
}
async fn restart_session(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Session>> {
    let mut session = state.store.session(&id)?;
    capture_codex_session_id(&state.store, &mut session)?;
    state
        .terminals
        .remove(&id)
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?;
    let mut workspace = state.store.workspace(&session.workspace_id)?;
    if workspace.kind == "base" {
        workspace = sync_project_session_workspace(&state, &workspace.project_id)?;
    }
    if session.kind == "codex" {
        session.additional_directories = state
            .store
            .workspace_locations(&workspace.id)?
            .into_iter()
            .filter(|location| {
                location.access_mode == "read_write"
                    && location.git_status == "ready"
                    && normalized_path(
                        location
                            .checkout_path
                            .as_deref()
                            .unwrap_or(&location.source_path),
                    ) != normalized_path(&session.cwd)
            })
            .map(|location| location.checkout_path.unwrap_or(location.source_path))
            .collect();
        state
            .store
            .replace_session_additional_directories(&session.id, &session.additional_directories)?;
    }
    let developer_instructions = treefold_developer_instructions(&state, &session, &workspace)?;
    let codex_extra_args = if session.kind == "codex" {
        state.settings.load()?.agents.codex.extra_args
    } else {
        vec![]
    };
    let process = state
        .terminals
        .spawn(
            &session,
            &workspace.project_id,
            developer_instructions.as_deref(),
            &codex_extra_args,
        )
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?;
    session.process_id = process.id;
    session.process_name = process.name;
    session.pid = process.pid.into();
    session.process_group_id = process.process_group_id.into();
    session.command = process.command;
    session.status = "running".into();
    persist_amux_process(&state.store, &id, &session)?;
    Ok(Json(session))
}
async fn close_session(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Session>> {
    let mut session = state.store.session(&id)?;
    if session.kind == "shell" {
        let _ = state.terminals.remove(&id).await;
        state.store.delete_session(&id)?;
        session.sidebar_visible = false;
        session.status = "closed".into();
        session.pid = 0;
        return Ok(Json(session));
    }
    capture_codex_session_id(&state.store, &mut session)?;
    if state.terminals.is_running(&id).await {
        let _ = state.terminals.stop(&id).await;
    }
    state.store.set_session_visible(&id, false)?;
    let mut session = state.store.session(&id)?;
    session.sidebar_visible = false;
    Ok(Json(session))
}
async fn open_session(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Session>> {
    state.store.set_session_visible(&id, true)?;
    get_session(State(state), AxumPath(id)).await
}
async fn delete_session(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<StatusCode> {
    let _ = state.terminals.remove(&id).await;
    state.store.delete_session(&id)?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct CreateTodo {
    title: String,
    description: Option<String>,
    session_id: Option<String>,
}
async fn create_todo(
    State(state): State<AppState>,
    AxumPath(workspace_id): AxumPath<String>,
    ApiJson(input): ApiJson<CreateTodo>,
) -> Result<(StatusCode, Json<Todo>)> {
    state.store.workspace(&workspace_id)?;
    if input.title.trim().is_empty() {
        return Err(AppError::BadRequest("title is required".into()));
    }
    let timestamp = now();
    let todo = Todo {
        id: id(),
        workspace_id,
        title: input.title.trim().into(),
        description: trimmed(input.description).unwrap_or_default(),
        status: if input.session_id.is_some() {
            "assigned".into()
        } else {
            "pending".into()
        },
        session_id: input.session_id,
        blocked_reason: None,
        created_at: timestamp.clone(),
        updated_at: timestamp,
    };
    state.store.create_todo(&todo)?;
    Ok((StatusCode::CREATED, Json(todo)))
}
#[derive(Deserialize)]
struct UpdateTodo {
    status: String,
    session_id: Option<String>,
}
async fn update_todo(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<UpdateTodo>,
) -> Result<StatusCode> {
    if !["pending", "assigned", "done"].contains(&input.status.as_str()) {
        return Err(AppError::BadRequest("invalid todo status".into()));
    }
    let _ = state.store.todo(&id)?;
    state
        .store
        .update_todo(&id, &input.status, input.session_id.as_deref())?;
    Ok(StatusCode::NO_CONTENT)
}
async fn get_settings(State(state): State<AppState>) -> Result<Json<crate::settings::Settings>> {
    Ok(Json(state.settings.load()?))
}
async fn update_settings(
    State(state): State<AppState>,
    ApiJson(input): ApiJson<SettingsPatch>,
) -> Result<Json<crate::settings::Settings>> {
    input
        .validate()
        .map_err(|error| AppError::BadRequest(error.to_string()))?;
    Ok(Json(state.settings.update(input)?))
}

async fn terminal_socket(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    Query(_): Query<HashMap<String, String>>,
    ws: WebSocketUpgrade,
) -> Result<impl IntoResponse> {
    state.store.session(&id)?;
    Ok(ws.on_upgrade(move |socket| proxy_terminal(socket, state, id)))
}

fn apply_amux_process(session: &mut Session, process: amux::model::Process) {
    session.process_id = process.id;
    session.process_name = process.name;
    session.status = format!("{:?}", process.state).to_ascii_lowercase();
    session.pid = process.pid.into();
    session.process_group_id = process.process_group_id.into();
    session.exit_code = process.exit_code.map(Into::into);
    session.exit_signal = process.exit_signal;
    session.command = process.command;
}

fn terminal_session_status(status: &str) -> bool {
    matches!(status, "exited" | "failed" | "closed" | "evicted")
}

async fn refresh_session_records(state: &AppState, sessions: Vec<Session>) -> Result<Vec<Session>> {
    let mut active = Vec::with_capacity(sessions.len());
    for mut session in sessions {
        if session.kind == "shell" && terminal_session_status(&session.status) {
            let _ = state.terminals.remove(&session.id).await;
            state.store.delete_session(&session.id)?;
            continue;
        }
        if let Ok(process) = state.terminals.inspect(&session.id).await {
            apply_amux_process(&mut session, process);
            if session.kind == "shell" && terminal_session_status(&session.status) {
                let _ = state.terminals.remove(&session.id).await;
                state.store.delete_session(&session.id)?;
                continue;
            }
            persist_amux_process(&state.store, &session.id, &session)?;
        }
        active.push(session);
    }
    Ok(active)
}

fn persist_amux_process(store: &Store, id: &str, session: &Session) -> Result<()> {
    store.set_session_process_runtime(
        id,
        &session.process_id,
        &session.process_name,
        &session.status,
        session.pid,
        session.process_group_id,
        session.exit_code,
        &session.exit_signal,
        &session.command,
    )?;
    Ok(())
}

async fn proxy_terminal(socket: WebSocket, state: AppState, id: String) {
    let Ok(amux_socket) = state.terminals.attach(&id).await else {
        return;
    };
    let _ = state.store.touch_session(&id);
    let (mut front_tx, mut front_rx) = socket.split();
    let (mut back_tx, mut back_rx) = amux_socket.split();
    loop {
        tokio::select! {
            message = front_rx.next() => match message {
                Some(Ok(Message::Binary(data))) => {
                    if back_tx.send(tokio_tungstenite::tungstenite::Message::Binary(data)).await.is_err() { break; }
                }
                Some(Ok(Message::Text(text))) => {
                    if back_tx.send(tokio_tungstenite::tungstenite::Message::Text(text.to_string().into())).await.is_err() { break; }
                }
                Some(Ok(Message::Ping(data))) => {
                    if back_tx.send(tokio_tungstenite::tungstenite::Message::Ping(data)).await.is_err() { break; }
                }
                Some(Ok(Message::Pong(data))) => {
                    if back_tx.send(tokio_tungstenite::tungstenite::Message::Pong(data)).await.is_err() { break; }
                }
                Some(Ok(Message::Close(_))) => {
                    let _ = back_tx.send(tokio_tungstenite::tungstenite::Message::Close(None)).await;
                    break;
                }
                None | Some(Err(_)) => break,
            },
            message = back_rx.next() => match message {
                Some(Ok(tokio_tungstenite::tungstenite::Message::Binary(data))) => {
                    if front_tx.send(Message::Binary(data)).await.is_err() { break; }
                }
                Some(Ok(tokio_tungstenite::tungstenite::Message::Text(text))) => {
                    if front_tx.send(Message::Text(text.to_string().into())).await.is_err() { break; }
                }
                Some(Ok(tokio_tungstenite::tungstenite::Message::Ping(data))) => {
                    if front_tx.send(Message::Ping(data)).await.is_err() { break; }
                }
                Some(Ok(tokio_tungstenite::tungstenite::Message::Pong(data))) => {
                    if front_tx.send(Message::Pong(data)).await.is_err() { break; }
                }
                Some(Ok(tokio_tungstenite::tungstenite::Message::Close(_))) => {
                    let _ = front_tx.send(Message::Close(None)).await;
                    break;
                }
                Some(Ok(tokio_tungstenite::tungstenite::Message::Frame(_))) => {},
                None | Some(Err(_)) => break,
            }
        }
    }
    if let Ok(process) = state.terminals.inspect(&id).await {
        let mut session = match state.store.session(&id) {
            Ok(session) => session,
            Err(_) => return,
        };
        apply_amux_process(&mut session, process);
        if session.kind == "shell" && terminal_session_status(&session.status) {
            let _ = state.terminals.remove(&id).await;
            let _ = state.store.delete_session(&id);
        } else {
            let _ = persist_amux_process(&state.store, &id, &session);
        }
    }
}


fn discover_codex_session_id(session: &Session) -> Option<String> {
    let codex_home = std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".codex")))?;
    let launch = chrono::DateTime::parse_from_rfc3339(&session.launch_started_at).ok()?;
    let mut pending = vec![codex_home.join("sessions")];
    let mut best: Option<(i64, String)> = None;
    while let Some(directory) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                pending.push(path);
                continue;
            }
            if path.extension().and_then(|value| value.to_str()) != Some("jsonl") {
                continue;
            }
            let Ok(file) = std::fs::File::open(path) else {
                continue;
            };
            let Some(Ok(line)) = BufReader::new(file).lines().next() else {
                continue;
            };
            let Ok(value) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            let payload = &value["payload"];
            if payload["cwd"].as_str() != Some(session.original_cwd.as_str()) {
                continue;
            }
            let Some(session_id) = payload["session_id"]
                .as_str()
                .or_else(|| payload["id"].as_str())
            else {
                continue;
            };
            let Some(timestamp) = payload["timestamp"]
                .as_str()
                .or_else(|| value["timestamp"].as_str())
                .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
            else {
                continue;
            };
            let distance = (timestamp.timestamp() - launch.timestamp()).abs();
            if distance <= 300 && best.as_ref().map_or(true, |current| distance < current.0) {
                best = Some((distance, session_id.to_owned()));
            }
        }
    }
    best.map(|(_, session_id)| session_id)
}

fn capture_codex_session_id(store: &Store, session: &mut Session) -> Result<()> {
    if session.kind != "codex" || session.codex_session_id.is_some() {
        return Ok(());
    }
    if let Some(codex_session_id) = discover_codex_session_id(session) {
        store.set_codex_session_id(&session.id, &codex_session_id)?;
        session.codex_session_id = Some(codex_session_id);
    }
    Ok(())
}
