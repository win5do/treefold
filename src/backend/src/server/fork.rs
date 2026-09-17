use super::*;

#[derive(Deserialize)]
pub(super) struct CreateFork {
    pub(super) description: Option<String>,
    pub(super) branch: Option<String>,
    pub(super) generated_branch: Option<String>,
}

#[derive(Serialize)]
pub(super) struct TodoForkResult {
    fork: Workspace,
    #[serde(skip_serializing_if = "Option::is_none")]
    session: Option<Session>,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_error: Option<String>,
}

pub(super) async fn create_todo_fork(
    State(state): State<AppState>,
    AxumPath(todo_id): AxumPath<String>,
) -> Result<(StatusCode, Json<TodoForkResult>)> {
    let todo = state.store.todo(&todo_id).await?;
    let owner = state.store.workspace(&todo.workspace_id).await?;
    ensure_active_workspace(&owner)?;
    if !["pending", "blocked"].contains(&todo.status.as_str()) {
        return Err(AppError::api(
            StatusCode::CONFLICT,
            "TODO_NOT_EXECUTABLE",
            "Todo must be pending or blocked",
        ));
    }
    let fork_active = if let Some(fork_id) = todo.fork_id.as_deref() {
        state
            .store
            .workspace(fork_id)
            .await
            .is_ok_and(|fork| fork.status == "active")
    } else {
        false
    };
    if fork_active {
        return Err(AppError::api(
            StatusCode::CONFLICT,
            "TODO_FORK_ACTIVE",
            "Todo already has an active execution Fork",
        ));
    }
    if !state.store.reserve_todo_for_fork(&todo.id).await? {
        return Err(AppError::api(
            StatusCode::CONFLICT,
            "TODO_NOT_EXECUTABLE",
            "Todo is no longer pending or blocked",
        ));
    }
    let description = todo.content.clone();
    let operation_state = state.clone();
    let parent_id = owner.id.clone();
    let created = blocking_git_operation(move || async move {
        create_fork_impl(
            operation_state,
            parent_id,
            CreateFork {
                generated_branch: None,
                branch: None,
                description: Some(description),
            },
        )
        .await
    })
    .await;
    let created = match created {
        Ok(created) => created,
        Err(error) => {
            state
                .store
                .restore_todo_after_fork_failure(
                    &todo.id,
                    todo.fork_id.as_deref(),
                    &todo.status,
                    todo.blocked_reason.as_deref(),
                )
                .await?;
            return Err(error);
        }
    };
    let fork = state.store.workspace(&created.workspace.id).await?;
    if !state
        .store
        .attach_todo_fork(&todo.id, todo.fork_id.as_deref(), &fork.id)
        .await?
    {
        return Err(AppError::api(
            StatusCode::CONFLICT,
            "TODO_FORK_ACTIVE",
            "Todo was started concurrently",
        ));
    }
    project_worktrees_cache().invalidate(&fork.project_id).await;
    spawn_workspace_setup_shells(state.clone(), fork.clone(), created.setup_shells).await;
    let session_result = create_session_for_workspace(
        &state,
        fork.clone(),
        CreateSession {
            name: Some("Todo Agent".into()),
            kind: Some("codex".into()),
            project_directory_id: None,
            initial_prompt: Some(todo.content),
        },
    )
    .await;
    let (session, session_error) = match session_result {
        Ok((_, Json(session))) => (Some(session), None),
        Err(error) => (None, Some(error.to_string())),
    };
    Ok((
        StatusCode::CREATED,
        Json(TodoForkResult {
            fork,
            session,
            session_error,
        }),
    ))
}

pub(super) async fn create_fork(
    State(state): State<AppState>,
    AxumPath(parent_id): AxumPath<String>,
    ApiJson(input): ApiJson<CreateFork>,
) -> Result<(StatusCode, Json<Workspace>)> {
    let operation_state = state.clone();
    let created = blocking_git_operation(move || async move {
        create_fork_impl(operation_state, parent_id, input).await
    })
    .await?;
    project_worktrees_cache()
        .invalidate(&created.workspace.project_id)
        .await;
    spawn_workspace_setup_shells(
        state.clone(),
        created.workspace.clone(),
        created.setup_shells,
    )
    .await;
    Ok((
        StatusCode::CREATED,
        Json(state.store.workspace(&created.workspace.id).await?),
    ))
}

pub(super) async fn create_fork_impl(
    state: AppState,
    parent_id: String,
    input: CreateFork,
) -> Result<CreatedWorkspace> {
    let parent = state.store.workspace(&parent_id).await?;
    if parent.status != "active" {
        return Err(AppError::BadRequest(
            "cannot fork an archived Workspace".into(),
        ));
    }
    if parent.kind != "workspace" || parent.parent_workspace_id.is_some() {
        return Err(AppError::BadRequest(
            "a Fork cannot create another Fork; create a sibling Fork from the parent Workspace"
                .into(),
        ));
    }
    let parent_locations = state.store.workspace_repositories(&parent_id).await?;
    let project = state.store.project(&parent.project_id).await?;
    if project.status != "active" {
        return Err(AppError::BadRequest(
            "cannot create a Fork in an archived Project".into(),
        ));
    }
    let fork_id = new_id();
    let project_directories = state.store.project_directories(&project.id).await?;
    let mut project_repositorys = Vec::new();
    for repository in state.store.repositories(&project.id).await? {
        project_repositorys.push(state.store.repository_as_directory(&repository.id).await?);
    }
    let explicit_branch = trimmed(input.branch).filter(|value| !value.is_empty());
    let branch = choose_shared_branch(
        &project_repositorys,
        explicit_branch.as_deref(),
        trimmed(input.generated_branch)
            .filter(|value| !value.is_empty())
            .as_deref(),
    )?;
    let worktree_root = super::worktree_names::reserve_worktree_root(&state.settings)?;
    let timestamp = now();
    let mut snapshots = Vec::new();
    let mut plans = Vec::new();
    for parent_location in &parent_locations {
        let project_repository = state
            .store
            .repository_as_directory(&parent_location.project_repository_id)
            .await?;
        let checkout_path = worktree_root
            .path()
            .join(repository_slug(&parent_location.repository_name))
            .to_string_lossy()
            .into_owned();
        let base_branch = parent_location.branch.clone().unwrap_or_default();
        let mut snapshot = git_workspace_repository(
            &fork_id,
            &project_repository,
            &timestamp,
            checkout_path.clone(),
            branch.clone(),
            base_branch.clone(),
            String::new(),
            parent_location.start_commit.clone(),
            None,
            None,
            "local_merge".into(),
        );
        snapshot.git_status = "creating".into();
        snapshot.start_commit = None;

        let Some(parent_path) = parent_location.checkout_path.as_deref() else {
            snapshot.git_status = "failed".into();
            snapshot.checkout_path = None;
            snapshot.delivery_status = "discarded".into();
            snapshot.creation_error = Some(format!(
                "parent location '{}' has no worktree{}",
                parent_location.repository_name,
                parent_location
                    .creation_error
                    .as_deref()
                    .map(|error| format!(": {error}"))
                    .unwrap_or_default()
            ));
            snapshots.push(snapshot);
            continue;
        };
        if let Err(error) = ensure_clean_workspace(parent_path, "parent Workspace Repository") {
            snapshot.git_status = "failed".into();
            snapshot.checkout_path = None;
            snapshot.delivery_status = "discarded".into();
            snapshot.creation_error = Some(error.to_string());
            snapshots.push(snapshot);
            continue;
        }
        let start_commit = match git_head(parent_path) {
            Ok(value) => value,
            Err(error) => {
                snapshot.git_status = "failed".into();
                snapshot.checkout_path = None;
                snapshot.delivery_status = "discarded".into();
                snapshot.creation_error = Some(error.to_string());
                snapshots.push(snapshot);
                continue;
            }
        };
        snapshot.forked_from_commit = Some(start_commit.clone());
        plans.push(WorkspaceWorktreePlan {
            location: project_repository,
            workspace_repository_id: snapshot.id.clone(),
            checkout_path,
            branch: branch.clone(),
            start_ref: start_commit,
            setup_directory_id: project_directories
                .iter()
                .find(|directory| {
                    directory.repository_id.as_deref()
                        == Some(&parent_location.project_repository_id)
                })
                .map(|directory| directory.id.clone())
                .unwrap_or_default(),
            setup_workdir: state
                .store
                .repository(&parent_location.project_repository_id)
                .await?
                .setup_workdir,
        });
        snapshots.push(snapshot);
    }
    let fork = Workspace {
        id: fork_id.clone(),
        project_id: parent.project_id,
        name: branch.clone(),
        description: trimmed(input.description).unwrap_or_default(),
        status: "active".into(),
        kind: "fork".into(),
        parent_workspace_id: Some(parent_id),
        runtime_id: fork_id.clone(),
        runtime_name: format!("treefold-{}", &fork_id[..10]),
        created_at: timestamp.clone(),
        updated_at: timestamp,
        checkout_mode: "worktree".into(),
        project_directory_id: String::new(),
        worktree_id: None,
        checkout_path: String::new(),
        target_branch: String::new(),
        start_commit: String::new(),
        branch,
        forked_from_commit: None,
        remote_name: None,
        remote_branch: None,
        branch_ownership: "managed".into(),
        delivery_mode: "local_merge".into(),
        delivery_status: "active".into(),
        close_outcome: None,
        integrated_commit: None,
        closed_at: None,
    };
    state
        .store
        .create_workspace_with_repositories(&fork, &snapshots)
        .await?;

    let outcomes = create_workspace_worktrees(plans);
    let setup_shells = record_workspace_worktree_outcomes(&state.store, outcomes).await?;
    Ok(CreatedWorkspace {
        workspace: state.store.workspace(&fork.id).await?,
        setup_shells,
    })
}
