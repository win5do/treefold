#[derive(Deserialize)]
struct CreateFork {
    name: String,
    description: Option<String>,
}

async fn create_fork(
    State(state): State<AppState>,
    AxumPath(parent_id): AxumPath<String>,
    ApiJson(input): ApiJson<CreateFork>,
) -> Result<(StatusCode, Json<Workspace>)> {
    let operation_state = state.clone();
    let created =
        blocking_git_operation(move || create_fork_impl(operation_state, parent_id, input)).await?;
    spawn_workspace_setup_shells(
        state.clone(),
        created.workspace.clone(),
        created.setup_shells,
    );
    Ok((
        StatusCode::CREATED,
        Json(state.store.workspace(&created.workspace.id)?),
    ))
}

fn create_fork_impl(
    state: AppState,
    parent_id: String,
    input: CreateFork,
) -> Result<CreatedWorkspace> {
    if input.name.trim().is_empty() {
        return Err(AppError::BadRequest("fork name is required".into()));
    }
    let parent = state.store.workspace(&parent_id)?;
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
    let parent_locations = state.store.workspace_locations(&parent_id)?;
    let project = state.store.project(&parent.project_id)?;
    if project.status != "active" {
        return Err(AppError::BadRequest(
            "cannot create a Fork in an archived Project".into(),
        ));
    }
    let fork_id = id();
    let project_locations = state.store.directories(&project.id)?;
    let branch = choose_shared_branch(
        &project_locations,
        None,
        &format!("f-{}", input.name.trim()),
    )?;
    let root = state
        .settings
        .worktree_root()?
        .join(format!("{}-{}", slug(&project.name), &project.id[..8]))
        .join(branch.replace('/', "-"));
    let timestamp = now();
    let mut snapshots = Vec::new();
    let mut plans = Vec::new();
    for parent_location in &parent_locations {
        let project_location = state
            .store
            .directory(&parent_location.project_location_id)?;
        if parent_location.access_mode == "read_only" {
            snapshots.push(read_only_workspace_location(
                &fork_id,
                &project_location,
                &timestamp,
            ));
            continue;
        }
        let checkout_path = root
            .join(format!(
                "{}-{}",
                slug(&parent_location.location_name),
                &parent_location.project_location_id[..6]
            ))
            .to_string_lossy()
            .into_owned();
        let base_branch = parent_location.branch.clone().unwrap_or_default();
        let mut snapshot = git_workspace_location(
            &fork_id,
            &project_location,
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
                parent_location.location_name,
                parent_location
                    .creation_error
                    .as_deref()
                    .map(|error| format!(": {error}"))
                    .unwrap_or_default()
            ));
            snapshots.push(snapshot);
            continue;
        };
        if let Err(error) = ensure_clean_workspace(parent_path, "parent Workspace location") {
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
            location: project_location,
            workspace_location_id: snapshot.id.clone(),
            checkout_path,
            branch: branch.clone(),
            start_ref: start_commit,
        });
        snapshots.push(snapshot);
    }
    let fork = Workspace {
        id: fork_id.clone(),
        project_id: parent.project_id,
        name: input.name.trim().into(),
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
        .create_workspace_with_locations(&fork, &snapshots)?;

    let outcomes = create_workspace_worktrees(plans);
    let setup_shells = record_workspace_worktree_outcomes(&state.store, outcomes)?;
    Ok(CreatedWorkspace {
        workspace: state.store.workspace(&fork.id)?,
        setup_shells,
    })
}

