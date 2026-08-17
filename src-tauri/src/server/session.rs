use super::*;

#[derive(Deserialize)]
pub(super) struct CreateSession {
    pub(super) name: Option<String>,
    pub(super) kind: Option<String>,
    pub(super) project_directory_id: Option<String>,
    pub(super) initial_prompt: Option<String>,
}

pub(super) async fn create_project_session(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    ApiJson(input): ApiJson<CreateSession>,
) -> Result<(StatusCode, Json<Session>)> {
    let workspace = sync_project_session_workspace(&state, &project_id)?;
    create_session_for_workspace(&state, workspace, input).await
}

pub(super) async fn list_project_sessions(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
) -> Result<Json<Vec<Session>>> {
    state.store.project(&project_id)?;
    reconcile_daemon_sessions(&state).await?;
    Ok(Json(state.store.project_sessions(&project_id)?))
}

pub(super) fn sync_project_session_workspace(
    state: &AppState,
    project_id: &str,
) -> Result<Workspace> {
    let project = state.store.project(project_id)?;
    if project.status != "active" {
        return Err(AppError::BadRequest(
            "cannot create a Session in an archived Project".into(),
        ));
    }
    let project_directories = state.store.project_directories(project_id)?;
    if project_directories.is_empty() {
        return Err(AppError::BadRequest(
            "Project has no location for a Session".into(),
        ));
    }
    let mut project_locations = state
        .store
        .repositories(project_id)?
        .iter()
        .map(|repository| state.store.repository_as_directory(&repository.id))
        .collect::<Result<Vec<_>>>()?;
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

pub(super) fn project_session_location(
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
        checkout_path: tracked_git.then(|| {
            location
                .checkout_path
                .clone()
                .unwrap_or_else(|| location.path.clone())
        }),
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

pub(super) async fn create_session(
    State(state): State<AppState>,
    AxumPath(workspace_id): AxumPath<String>,
    ApiJson(input): ApiJson<CreateSession>,
) -> Result<(StatusCode, Json<Session>)> {
    let workspace = state.store.workspace(&workspace_id)?;
    create_session_for_workspace(&state, workspace, input).await
}

pub(super) async fn list_sessions(
    State(state): State<AppState>,
    AxumPath(workspace_id): AxumPath<String>,
) -> Result<Json<Vec<Session>>> {
    state.store.workspace(&workspace_id)?;
    reconcile_daemon_sessions(&state).await?;
    Ok(Json(state.store.sessions(&workspace_id)?))
}

#[derive(Deserialize)]
pub(super) struct ReorderSessions {
    session_ids: Vec<String>,
}

pub(super) async fn reorder_sessions(
    State(state): State<AppState>,
    AxumPath(workspace_id): AxumPath<String>,
    ApiJson(input): ApiJson<ReorderSessions>,
) -> Result<Json<Vec<Session>>> {
    ensure_active_workspace(&state.store.workspace(&workspace_id)?)?;
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

pub(super) async fn create_session_for_workspace(
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
    let repositories = state.store.workspace_repositories(&workspace.id)?;
    let directories = state.store.workspace_directories(&workspace.id)?;
    let repository_is_ready = |directory: &&WorkspaceDirectory| {
        directory
            .workspace_repository_id
            .as_deref()
            .and_then(|id| repositories.iter().find(|repository| repository.id == id))
            .is_some_and(|repository| repository.git_status == "ready")
    };
    let selected_directory = if let Some(directory_id) = input.project_directory_id.as_deref() {
        directories
            .iter()
            .find(|directory| directory.project_directory_id == directory_id)
            .ok_or_else(|| {
                AppError::BadRequest("project directory does not belong to project".into())
            })?
    } else {
        directories
            .iter()
            .find(|directory| {
                project.default_location_id.as_deref()
                    == Some(directory.project_directory_id.as_str())
                    && repository_is_ready(directory)
            })
            .or_else(|| {
                directories.iter().find(|directory| {
                    directory.access_mode == "read_write" && repository_is_ready(directory)
                })
            })
            .or_else(|| {
                (workspace.kind == "base")
                    .then(|| directories.first())
                    .flatten()
            })
            .ok_or_else(|| AppError::BadRequest("Workspace has no usable location".into()))?
    };
    let selected_repository = selected_directory
        .workspace_repository_id
        .as_deref()
        .and_then(|id| repositories.iter().find(|repository| repository.id == id));
    if let Some(repository) =
        selected_repository.filter(|repository| repository.git_status != "ready")
    {
        return Err(AppError::BadRequest(format!(
            "Workspace Repository '{}' is unavailable: {}",
            repository.location_name,
            repository
                .creation_error
                .as_deref()
                .unwrap_or(&repository.git_status)
        )));
    }
    if kind == "codex" && selected_repository.is_none() {
        return Err(AppError::BadRequest(
            "Codex must start in an available Git location; non-Git locations are read-only context"
                .into(),
        ));
    }
    let cwd = selected_directory.path.clone();
    if !Path::new(&cwd).is_dir() {
        return Err(AppError::BadRequest(format!(
            "Session location is unavailable: {cwd}"
        )));
    }
    let mut additional_directories = Vec::new();
    let mut read_only_contexts = Vec::new();
    let selected_name = Some(selected_directory.name.clone());
    let mut seen_repository_roots = std::collections::HashSet::new();
    for repository in &repositories {
        let root = repository
            .checkout_path
            .clone()
            .unwrap_or_else(|| repository.source_path.clone());
        if repository.git_status == "ready"
            && seen_repository_roots.insert(normalized_path(&root))
            && normalized_path(&root) != normalized_path(&cwd)
        {
            additional_directories.push(root);
        }
    }
    for directory in &directories {
        if directory.access_mode == "read_only" {
            read_only_contexts.push(directory.path.clone());
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
    if kind == "shell"
        && name == "shell"
        && let Some(selected) = selected_name
    {
        name = format!("shell · {selected}");
    }
    let mut session = Session {
        id: session_id.clone(),
        workspace_id,
        name,
        kind: kind.clone(),
        original_cwd: cwd.clone(),
        cwd: cwd.clone(),
        initial_prompt: trimmed(input.initial_prompt).unwrap_or_default(),
        codex_session_id: None,
        visibility: "visible".into(),
        hidden_at: None,
        evicted_at: None,
        amux_workspace_name: crate::terminal::TerminalManager::workspace_name(&cwd),
        amux_process_name: session_id.clone(),
        status: "stopped".into(),
        exit_code: None,
        exit_signal: String::new(),
        argv: vec![],
        io_mode: "tty".into(),
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
            session.argv = process.command;
            session.status = "running".into();
            persist_amux_process(&state.store, &session.id, &session)?;
        }
        Err(error) => {
            session.status = "failed".into();
            state
                .store
                .set_session_runtime(&session.id, "failed", None, "", &session.argv)?;
            return Err(AppError::BadRequest(error.to_string()));
        }
    }
    Ok((StatusCode::CREATED, Json(session)))
}

pub(super) async fn get_session(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Session>> {
    reconcile_daemon_sessions(&state).await?;
    Ok(Json(state.store.session(&id)?))
}

#[derive(Deserialize)]
pub(super) struct UpdateSession {
    name: String,
}

pub(super) async fn update_session(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<UpdateSession>,
) -> Result<Json<Session>> {
    ensure_session_owner_active(&state, &state.store.session(&id)?)?;
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("Session name cannot be empty".into()));
    }
    state.store.rename_session(&id, name)?;
    Ok(Json(state.store.session(&id)?))
}
pub(super) async fn stop_session(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<StatusCode> {
    let session = state.store.session(&id)?;
    state
        .terminals
        .stop_existing(&session.amux_workspace_name, &session.amux_process_name)
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?;
    state.store.set_session_status(&id, "stopped")?;
    Ok(StatusCode::NO_CONTENT)
}
pub(super) async fn restart_session(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Session>> {
    let mut session = state.store.session(&id)?;
    ensure_session_owner_active(&state, &session)?;
    capture_codex_session_id(&state.store, &mut session)?;
    state
        .terminals
        .remove_existing(&session.amux_workspace_name, &session.amux_process_name)
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
    session.argv = process.command;
    session.status = "running".into();
    persist_amux_process(&state.store, &id, &session)?;
    Ok(Json(session))
}
pub(super) async fn close_session(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Session>> {
    let mut session = state.store.session(&id)?;
    if session.kind == "shell" || session.kind == "command" {
        let _ = state
            .terminals
            .remove_existing(&session.amux_workspace_name, &session.amux_process_name)
            .await;
        state.store.delete_session(&id)?;
        session.visibility = "hidden".into();
        session.status = "stopped".into();
        return Ok(Json(session));
    }
    capture_codex_session_id(&state.store, &mut session)?;
    let _ = state
        .terminals
        .remove_existing(&session.amux_workspace_name, &session.amux_process_name)
        .await;
    state.store.set_session_status(&id, "stopped")?;
    state.store.set_session_visibility(&id, "hidden")?;
    let mut session = state.store.session(&id)?;
    session.visibility = "hidden".into();
    Ok(Json(session))
}
pub(super) async fn open_session(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Session>> {
    ensure_session_owner_active(&state, &state.store.session(&id)?)?;
    state.store.set_session_visibility(&id, "visible")?;
    get_session(State(state), AxumPath(id)).await
}
pub(super) async fn delete_session(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<StatusCode> {
    if let Ok(session) = state.store.session(&id) {
        let _ = state
            .terminals
            .remove_existing(&session.amux_workspace_name, &session.amux_process_name)
            .await;
    }
    state.store.delete_session(&id)?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub(super) struct CreateTodo {
    content: String,
}
pub(super) async fn create_todo(
    State(state): State<AppState>,
    AxumPath(workspace_id): AxumPath<String>,
    ApiJson(input): ApiJson<CreateTodo>,
) -> Result<(StatusCode, Json<Todo>)> {
    let requested = state.store.workspace(&workspace_id)?;
    ensure_active_workspace(&requested)?;
    if requested.kind == "base" {
        return Err(AppError::BadRequest(
            "Project Sessions do not own Todos".into(),
        ));
    }
    if input.content.trim().is_empty() {
        return Err(AppError::BadRequest("content is required".into()));
    }
    let owner_id = requested
        .parent_workspace_id
        .clone()
        .unwrap_or(workspace_id);
    let timestamp = now();
    let todo = Todo {
        id: id(),
        workspace_id: owner_id,
        content: input.content.trim().into(),
        status: "pending".into(),
        fork_id: None,
        blocked_reason: None,
        created_at: timestamp.clone(),
        updated_at: timestamp,
    };
    state.store.create_todo(&todo)?;
    Ok((StatusCode::CREATED, Json(todo)))
}
#[derive(Deserialize)]
pub(super) struct UpdateTodo {
    content: Option<String>,
    status: Option<String>,
}
pub(super) async fn update_todo(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<UpdateTodo>,
) -> Result<Json<Todo>> {
    if input.content.is_none() && input.status.is_none() {
        return Err(AppError::BadRequest("content or status is required".into()));
    }
    let todo = state.store.todo(&id)?;
    ensure_active_workspace(&state.store.workspace(&todo.workspace_id)?)?;
    if let Some(content) = input.content.as_deref() {
        if content.trim().is_empty() {
            return Err(AppError::BadRequest("content must not be empty".into()));
        }
    }
    if let Some(status) = input.status.as_deref() {
        if !["pending", "done"].contains(&status) {
            return Err(AppError::BadRequest(
                "status must be pending or done".into(),
            ));
        }
        if todo.fork_id.as_deref().is_some_and(|fork_id| {
            state
                .store
                .workspace(fork_id)
                .is_ok_and(|fork| fork.status == "active")
        }) {
            return Err(AppError::api(
                StatusCode::CONFLICT,
                "TODO_FORK_ACTIVE",
                "archive or finish the active Fork before changing this Todo's status",
            ));
        }
    }
    if let Some(content) = input.content.as_deref() {
        state.store.edit_todo(&id, Some(content.trim()))?;
    }
    if let Some(status) = input.status.as_deref() {
        state.store.update_todo(&id, status)?;
    }
    Ok(Json(state.store.todo(&id)?))
}

pub(super) async fn delete_todo(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<StatusCode> {
    let todo = state.store.todo(&id)?;
    if todo.status == "in_progress"
        || todo.fork_id.as_deref().is_some_and(|fork_id| {
            state
                .store
                .workspace(fork_id)
                .is_ok_and(|fork| fork.status == "active")
        })
    {
        return Err(AppError::api(
            StatusCode::CONFLICT,
            "TODO_FORK_ACTIVE",
            "archive or finish the active Fork before deleting this Todo",
        ));
    }
    state.store.delete_todo(&id)?;
    Ok(StatusCode::NO_CONTENT)
}

pub(super) fn ensure_session_owner_active(state: &AppState, session: &Session) -> Result<()> {
    let workspace = state.store.workspace(&session.workspace_id)?;
    if workspace.status != "active"
        || state.store.project(&workspace.project_id)?.status != "active"
    {
        return Err(AppError::BadRequest(
            "Archived Projects, Workspaces, and Forks are read-only".into(),
        ));
    }
    Ok(())
}
pub(super) async fn get_settings(
    State(state): State<AppState>,
) -> Result<Json<crate::settings::Settings>> {
    Ok(Json(state.settings.load()?))
}
pub(super) async fn update_settings(
    State(state): State<AppState>,
    ApiJson(input): ApiJson<SettingsPatch>,
) -> Result<Json<crate::settings::Settings>> {
    input
        .validate()
        .map_err(|error| AppError::BadRequest(error.to_string()))?;
    Ok(Json(state.settings.update(input)?))
}

pub(super) async fn terminal_socket(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    Query(_): Query<HashMap<String, String>>,
    ws: WebSocketUpgrade,
) -> Result<impl IntoResponse> {
    state.store.session(&id)?;
    Ok(ws.on_upgrade(move |socket| proxy_terminal(socket, state, id)))
}

pub(super) fn apply_amux_process(session: &mut Session, process: amux::model::Process) {
    session.status =
        strict_process_status(&format!("{:?}", process.state).to_ascii_lowercase()).into();
    session.exit_code = process.exit_code.map(Into::into);
    session.exit_signal = process.exit_signal;
    session.argv = process.command;
}

pub(super) fn strict_process_status(status: &str) -> &'static str {
    match status {
        "created" | "starting" | "running" => "running",
        "exited" => "exited",
        "failed" => "failed",
        _ => "stopped",
    }
}

pub(super) async fn reconcile_daemon_sessions(state: &AppState) -> Result<()> {
    // A query must never revive the daemon. Persisted activity is stale whenever
    // the named daemon is absent, and a fresh snapshot is authoritative when it exists.
    state.store.stop_active_sessions()?;
    let Some(processes) = state.terminals.existing_processes().await? else {
        return Ok(());
    };
    for process in processes {
        reconcile_process(state, &process, false)?;
    }
    Ok(())
}

pub(super) fn reconcile_process_event(
    state: &AppState,
    event: crate::terminal::TreefoldProcessEvent,
) -> Result<()> {
    let removed = matches!(
        event.event.kind,
        amux::model::ProcessEventKind::ProcessRemoved
    );
    let process = crate::terminal::treefold_process_view(&event.event.process, event.session_id);
    reconcile_process(state, &process, removed)
}

pub(super) fn reconcile_process(
    state: &AppState,
    process: &crate::terminal::TreefoldProcessView,
    removed: bool,
) -> Result<()> {
    let status = if removed {
        "stopped"
    } else {
        strict_process_status(&process.state)
    };
    if let Some(mut session) = state
        .store
        .session_by_amux_identity(&process.workspace_name, &process.name)?
    {
        session.status = reconciled_status(&session.status, status).into();
        session.exit_code = process.exit_code.map(Into::into);
        session.exit_signal = process.exit_signal.clone();
        session.argv = process.command.clone();
        return persist_amux_process(&state.store, &session.id, &session);
    }

    // Removal is only a lifecycle update for an already known Session. In
    // particular, a late removal event after Close must not rediscover the
    // Command that Close just deleted.
    if removed {
        return Ok(());
    }

    // A root marker identifies Treefold's own Shell/Codex process. It is not a
    // separately discoverable Command Session.
    if process.session_root {
        if let Some(session_id) = process.session_id.as_deref()
            && let Ok(mut session) = state.store.session(session_id)
            && session.amux_process_name == process.name
        {
            session.status = reconciled_status(&session.status, status).into();
            session.exit_code = process.exit_code.map(Into::into);
            session.exit_signal = process.exit_signal.clone();
            session.argv = process.command.clone();
            return persist_amux_process(&state.store, &session.id, &session);
        }
        return Ok(());
    }

    let workspace_id = process
        .session_id
        .as_deref()
        .and_then(|id| state.store.session(id).ok())
        .map(|session| session.workspace_id)
        .or_else(|| {
            workspace_for_process_cwd(&state.store, &process.cwd)
                .ok()
                .flatten()
        });
    let Some(workspace_id) = workspace_id else {
        return Ok(());
    };
    let timestamp = process
        .started_at
        .clone()
        .unwrap_or_else(|| process.created_at.clone());
    let session = Session {
        id: id(),
        workspace_id,
        name: process.name.clone(),
        kind: "command".into(),
        cwd: process.cwd.clone(),
        original_cwd: process.cwd.clone(),
        initial_prompt: String::new(),
        codex_session_id: None,
        visibility: "visible".into(),
        hidden_at: None,
        evicted_at: None,
        amux_workspace_name: process.workspace_name.clone(),
        amux_process_name: process.name.clone(),
        status: status.into(),
        exit_code: process.exit_code.map(Into::into),
        exit_signal: process.exit_signal.clone(),
        argv: process.command.clone(),
        io_mode: process.io_mode.clone(),
        launch_started_at: timestamp,
        last_attached_at: None,
        created_at: process.created_at.clone(),
        updated_at: now(),
        additional_directories: vec![],
    };
    match state.store.create_session(&session) {
        Ok(()) => Ok(()),
        Err(_) => {
            // Snapshot and event reconciliation may race. The stable unique key
            // makes a concurrent insert harmless and the winner is refreshed.
            if let Some(mut existing) = state
                .store
                .session_by_amux_identity(&process.workspace_name, &process.name)?
            {
                existing.status = reconciled_status(&existing.status, status).into();
                existing.argv = process.command.clone();
                existing.exit_code = process.exit_code.map(Into::into);
                existing.exit_signal = process.exit_signal.clone();
                persist_amux_process(&state.store, &existing.id, &existing)
            } else {
                Err(AppError::BadRequest(
                    "failed to persist discovered Command Session".into(),
                ))
            }
        }
    }
}

pub(super) fn reconciled_status<'a>(current: &'a str, observed: &'a str) -> &'a str {
    // Stop is an explicit user action. The daemon may emit its terminal event
    // after the handler persisted `stopped`; that late event must not turn the
    // Session into a natural exit. A later running observation (Restart) still
    // transitions it back to running.
    if current == "stopped" && matches!(observed, "exited" | "failed") {
        "stopped"
    } else {
        observed
    }
}

pub(super) fn workspace_for_process_cwd(store: &Store, cwd: &str) -> Result<Option<String>> {
    let cwd = std::fs::canonicalize(cwd).unwrap_or_else(|_| PathBuf::from(cwd));
    Ok(store
        .session_workspace_candidates()?
        .into_iter()
        .filter_map(|(workspace_id, path)| {
            let path = std::fs::canonicalize(&path).unwrap_or_else(|_| PathBuf::from(path));
            cwd.starts_with(&path)
                .then_some((path.components().count(), workspace_id))
        })
        .max_by_key(|(depth, _)| *depth)
        .map(|(_, workspace_id)| workspace_id))
}

pub(super) async fn refresh_session_records(
    state: &AppState,
    sessions: Vec<Session>,
) -> Result<Vec<Session>> {
    reconcile_daemon_sessions(state).await?;
    sessions
        .into_iter()
        .map(|session| state.store.session(&session.id))
        .collect()
}

pub(super) fn persist_amux_process(store: &Store, id: &str, session: &Session) -> Result<()> {
    store.set_session_runtime(
        id,
        &session.status,
        session.exit_code,
        &session.exit_signal,
        &session.argv,
    )?;
    Ok(())
}

pub(super) async fn proxy_terminal(socket: WebSocket, state: AppState, id: String) {
    let Ok(session) = state.store.session(&id) else {
        return;
    };
    let Ok(Some(amux_socket)) = state
        .terminals
        .attach_existing(&session.amux_workspace_name, &session.amux_process_name)
        .await
    else {
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
    if let Ok(Some(process)) = state
        .terminals
        .inspect_existing(&session.amux_workspace_name, &session.amux_process_name)
        .await
    {
        let mut session = match state.store.session(&id) {
            Ok(session) => session,
            Err(_) => return,
        };
        apply_amux_process(&mut session, process);
        let _ = persist_amux_process(&state.store, &id, &session);
    }
}

pub(super) fn discover_codex_session_id(session: &Session) -> Option<String> {
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
            if distance <= 300 && best.as_ref().is_none_or(|current| distance < current.0) {
                best = Some((distance, session_id.to_owned()));
            }
        }
    }
    best.map(|(_, session_id)| session_id)
}

pub(super) fn capture_codex_session_id(store: &Store, session: &mut Session) -> Result<()> {
    if session.kind != "codex" || session.codex_session_id.is_some() {
        return Ok(());
    }
    if let Some(codex_session_id) = discover_codex_session_id(session) {
        store.set_codex_session_id(&session.id, &codex_session_id)?;
        session.codex_session_id = Some(codex_session_id);
    }
    Ok(())
}
