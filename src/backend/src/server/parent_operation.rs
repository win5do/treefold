use super::*;

#[derive(Deserialize)]
pub(super) struct ParentOperationQuery {
    direction: String,
}

#[derive(Deserialize)]
pub(super) struct StartParentOperation {
    #[serde(default)]
    strategy: Option<String>,
}

#[derive(Clone)]
pub(super) struct ParentOperationContext {
    workspace: Workspace,
    location: WorkspaceRepository,
    repository: Directory,
    source_path: String,
    source_branch: String,
    source_head: String,
    target_scope: String,
    target_workspace_id: Option<String>,
    target_path: String,
    target_branch: String,
    parent_head: String,
}

pub(super) async fn get_parent_operation_preview(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    Query(query): Query<ParentOperationQuery>,
) -> Result<Json<ParentOperationPreview>> {
    validate_parent_direction(&query.direction)?;
    let common = state
        .store
        .repository(
            &state
                .store
                .workspace_repository(&id)
                .await?
                .project_repository_id,
        )
        .await?
        .git_common_dir;
    blocking_git_operation_for(common, move || async move {
        parent_operation_preview_impl(&state, &id, &query.direction)
            .await
            .map(Json)
    })
    .await
}

pub(super) async fn start_parent_operation(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    Query(query): Query<ParentOperationQuery>,
    ApiJson(input): ApiJson<StartParentOperation>,
) -> Result<Json<ParentOperation>> {
    validate_parent_direction(&query.direction)?;
    let strategy = input.strategy.unwrap_or_else(|| {
        if query.direction == "update" {
            "rebase".into()
        } else {
            "merge".into()
        }
    });
    validate_parent_strategy(&query.direction, &strategy)?;
    let common = state
        .store
        .repository(
            &state
                .store
                .workspace_repository(&id)
                .await?
                .project_repository_id,
        )
        .await?
        .git_common_dir;
    blocking_git_operation_for(common, move || async move {
        start_parent_operation_impl(&state, &id, &query.direction, &strategy, "standalone", None)
            .await
            .map(Json)
    })
    .await
}

pub(super) async fn get_parent_operation(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<ParentOperation>> {
    let operation = state.store.parent_operation(&id).await?;
    let common = state
        .store
        .repository(&operation.source_repository_id)
        .await?
        .git_common_dir;
    blocking_git_operation_for(common, move || async move {
        reconcile_parent_operation(&state, &operation)
            .await
            .map(Json)
    })
    .await
}

pub(super) async fn resolve_parent_operation_with_codex(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<(StatusCode, Json<Session>)> {
    let operation = state.store.parent_operation(&id).await?;
    let operation = reconcile_parent_operation(&state, &operation).await?;
    if !matches!(operation.status.as_str(), "conflicted" | "resolving") {
        return Err(AppError::BadRequest(
            "only a conflicted parent operation can be resolved with Codex".into(),
        ));
    }
    if let Some(session_id) = operation.resolver_session_id.as_deref() {
        return Ok((StatusCode::OK, Json(state.store.session(session_id).await?)));
    }

    let source_workspace = state.store.workspace(&operation.workspace_id).await?;
    let resolver_workspace = if operation.direction == "update" {
        source_workspace
    } else if let Some(parent_id) = operation.target_workspace_id.as_deref() {
        state.store.workspace(parent_id).await?
    } else {
        sync_project_session_workspace(&state, &source_workspace.project_id).await?
    };
    let directories = state
        .store
        .workspace_directories(&resolver_workspace.id)
        .await?;
    let repository_ids = state
        .store
        .workspace_repositories(&resolver_workspace.id)
        .await?
        .into_iter()
        .filter(|location| location.project_repository_id == operation.source_repository_id)
        .map(|location| location.id)
        .collect::<std::collections::HashSet<_>>();
    let selected = directories
        .iter()
        .find(|directory| {
            directory
                .workspace_repository_id
                .as_ref()
                .is_some_and(|id| repository_ids.contains(id))
        })
        .ok_or_else(|| {
            AppError::BadRequest("resolver Workspace has no matching Repository directory".into())
        })?;
    let conflicts = unmerged_paths(&operation.target_path)?;
    let squash_command = super::squash_delivery::continue_command(&operation);
    let continue_command = if operation.strategy == "squash" {
        squash_command.as_str()
    } else if operation.strategy == "rebase" {
        "git rebase --continue (repeat until the rebase is complete)"
    } else {
        "git merge --continue"
    };
    let prompt = format!(
        "Resolve Treefold parent operation {id}.\n\nPurpose: {direction} using {strategy}.\nFixed source HEAD: {source_head}\nFixed parent HEAD: {parent_head}\nModified checkout: {target_path}\nExpected branch: {target_branch}\nConflicted paths: {conflicts}\n\nYou are authorized to inspect and edit only this conflicted checkout, resolve every conflict, stage the resolutions, run relevant verification, and finish with `{continue_command}`. Do not push, reset, checkout another branch, abort, or perform unrelated history operations. Confirm the final Git operation has ended and verification passes.",
        id = operation.id,
        direction = operation.direction,
        strategy = operation.strategy,
        source_head = operation.source_head,
        parent_head = operation.parent_head,
        target_path = operation.target_path,
        target_branch = operation.target_branch,
        conflicts = if conflicts.is_empty() {
            "(none currently reported)".into()
        } else {
            conflicts.join(", ")
        },
    );
    let (_, Json(session)) = create_session_for_workspace(
        &state,
        resolver_workspace,
        CreateSession {
            name: Some(format!(
                "Resolve {} {}",
                operation.direction, operation.strategy
            )),
            kind: Some("codex".into()),
            project_directory_id: Some(selected.project_directory_id.clone()),
            initial_prompt: Some(prompt),
        },
    )
    .await?;
    state
        .store
        .set_parent_operation_resolver(&operation.id, &session.id)
        .await?;
    Ok((StatusCode::CREATED, Json(session)))
}

pub(super) async fn abort_parent_operation(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<ParentOperation>> {
    let operation = state.store.parent_operation(&id).await?;
    if let Some(session_id) = operation.resolver_session_id.as_deref()
        && let Ok(session) = state.store.session(session_id).await
    {
        let _ = state
            .terminals
            .stop_existing(&session.amux_workspace_name, &session.amux_process_name)
            .await;
    }
    let common = state
        .store
        .repository(&operation.source_repository_id)
        .await?
        .git_common_dir;
    blocking_git_operation_for(common, move || async move {
        abort_parent_operation_impl(&state, &operation)
            .await
            .map(Json)
    })
    .await
}

pub(super) fn validate_parent_direction(direction: &str) -> Result<()> {
    if matches!(direction, "update" | "integrate") {
        Ok(())
    } else {
        Err(AppError::BadRequest(
            "direction must be update or integrate".into(),
        ))
    }
}

pub(super) fn validate_parent_strategy(direction: &str, strategy: &str) -> Result<()> {
    if (direction == "update" && matches!(strategy, "rebase" | "merge"))
        || (direction == "integrate" && matches!(strategy, "merge" | "squash"))
    {
        Ok(())
    } else {
        Err(AppError::BadRequest(
            "invalid strategy for parent operation".into(),
        ))
    }
}

pub(super) async fn parent_operation_context(
    state: &AppState,
    id: &str,
    direction: &str,
) -> Result<ParentOperationContext> {
    validate_parent_direction(direction)?;
    let location = state.store.workspace_repository(id).await?;
    let workspace = state.store.workspace(&location.workspace_id).await?;
    if workspace.status != "active"
        || location.access_mode != "read_write"
        || location.git_status != "ready"
    {
        return Err(AppError::BadRequest(
            "parent operations require an active, writable Repository".into(),
        ));
    }
    let repository = state
        .store
        .repository_as_directory(&location.project_repository_id)
        .await?;
    let source_path = workspace_repository_git_path(&location)?.to_owned();
    let source_branch = location
        .branch
        .clone()
        .ok_or_else(|| AppError::BadRequest("Workspace Repository has no branch".into()))?;
    let source_head = git_head(&source_path)?;
    let (parent_path, parent_branch) =
        workspace_repository_delivery_target(state, &workspace, &location).await?;
    let parent_head = git_head(&parent_path)?;
    let (target_scope, target_workspace_id) = if direction == "update" {
        (
            if workspace.kind == "fork" {
                "fork"
            } else {
                "workspace"
            }
            .into(),
            Some(workspace.id.clone()),
        )
    } else if let Some(parent_id) = workspace.parent_workspace_id.as_deref() {
        ("parent_workspace".into(), Some(parent_id.into()))
    } else {
        ("project".into(), None)
    };
    let (target_path, target_branch) = if direction == "update" {
        (source_path.clone(), source_branch.clone())
    } else {
        (parent_path, parent_branch)
    };
    Ok(ParentOperationContext {
        workspace,
        location,
        repository,
        source_path,
        source_branch,
        source_head,
        target_scope,
        target_workspace_id,
        target_path,
        target_branch,
        parent_head,
    })
}

pub(super) async fn parent_operation_preview_impl(
    state: &AppState,
    id: &str,
    direction: &str,
) -> Result<ParentOperationPreview> {
    let context = parent_operation_context(state, id, direction).await?;
    let operation =
        if let Some(operation) = state.store.latest_parent_operation(id, direction).await? {
            Some(reconcile_parent_operation(state, &operation).await?)
        } else {
            None
        };
    let mut blockers = Vec::new();
    if !git_status_porcelain(&context.source_path)?.is_empty() {
        blockers.push("Workspace Repository has uncommitted changes".into());
    }
    if normalized_path(&context.target_path) != normalized_path(&context.source_path)
        && !git_status_porcelain(&context.target_path)?.is_empty()
    {
        blockers.push("Parent target has uncommitted changes".into());
    }
    if git_operation_in_progress(&context.source_path)? {
        blockers.push("Workspace Repository already has a Git operation in progress".into());
    }
    if normalized_path(&context.target_path) != normalized_path(&context.source_path)
        && git_operation_in_progress(&context.target_path)?
    {
        blockers.push("Parent target already has a Git operation in progress".into());
    }
    if let Some(active) = state
        .store
        .active_parent_operation_for_target(
            &context.location.project_repository_id,
            &context.target_path,
        )
        .await?
        && operation
            .as_ref()
            .is_none_or(|current| current.id != active.id)
    {
        blockers.push(format!(
            "another parent operation ({}) is active on this target",
            active.id
        ));
    }
    let outcome = parent_operation_outcome(
        if direction == "update" {
            &context.source_path
        } else {
            &context.target_path
        },
        if direction == "update" {
            &context.source_head
        } else {
            &context.parent_head
        },
        if direction == "update" {
            &context.parent_head
        } else {
            &context.source_head
        },
    )
    .await?;
    Ok(ParentOperationPreview {
        direction: direction.into(),
        repository_name: context.location.repository_name,
        source_path: context.source_path,
        source_branch: context.source_branch,
        target_scope: context.target_scope,
        target_path: context.target_path,
        target_branch: context.target_branch,
        source_head: context.source_head,
        parent_head: context.parent_head,
        outcome,
        blockers,
        operation,
    })
}

pub(super) async fn start_parent_operation_impl(
    state: &AppState,
    id: &str,
    direction: &str,
    strategy: &str,
    origin: &str,
    delivery_operation_id: Option<&str>,
) -> Result<ParentOperation> {
    validate_parent_strategy(direction, strategy)?;
    if let Some(current) = state.store.latest_parent_operation(id, direction).await? {
        let current = reconcile_parent_operation(state, &current).await?;
        if matches!(
            current.status.as_str(),
            "active" | "conflicted" | "resolving" | "recovery_required"
        ) {
            if current.strategy != strategy {
                return Err(AppError::BadRequest(
                    "a different integration strategy is already in progress".into(),
                ));
            }
            return Ok(current);
        }
        if origin == "finish"
            && current.origin == "finish"
            && current.status == "completed"
            && current.phase != "reopened"
        {
            if current.strategy != strategy
                || git_head(&current.source_path)? != current.source_head
            {
                return Err(AppError::BadRequest(
                    "delivery strategy differs from the completed operation".into(),
                ));
            }
            return Ok(current);
        }
    }
    let context = parent_operation_context(state, id, direction).await?;
    ensure_clean_workspace(&context.source_path, "Workspace Repository")?;
    ensure_checked_out_branch(
        &context.source_path,
        &context.source_branch,
        "Workspace Repository",
    )?;
    if normalized_path(&context.target_path) != normalized_path(&context.source_path) {
        ensure_clean_workspace(&context.target_path, "parent target")?;
    }
    ensure_checked_out_branch(
        &context.target_path,
        &context.target_branch,
        "parent target",
    )?;
    if git_operation_in_progress(&context.source_path)?
        || git_operation_in_progress(&context.target_path)?
    {
        return Err(AppError::BadRequest(
            "another Git operation is already in progress".into(),
        ));
    }
    if let Some(active) = state
        .store
        .active_parent_operation_for_target(
            &context.location.project_repository_id,
            &context.target_path,
        )
        .await?
    {
        return Err(AppError::BadRequest(format!(
            "parent operation {} already owns this target",
            active.id
        )));
    }
    let operation_id = new_id();
    let before_head = if direction == "update" {
        context.source_head.clone()
    } else {
        context.parent_head.clone()
    };
    let recovery_ref = format!("refs/treefold/recovery/parent-{operation_id}");
    command_output(
        Path::new(&context.repository.path),
        "git",
        &["update-ref", &recovery_ref, &before_head],
    )
    .map_err(|error| {
        AppError::BadRequest(format!("create parent-operation recovery ref: {error}"))
    })?;
    let timestamp = now();
    let operation = ParentOperation {
        id: operation_id,
        workspace_repository_id: id.into(),
        workspace_id: context.workspace.id,
        direction: direction.into(),
        strategy: strategy.into(),
        origin: origin.into(),
        source_repository_id: context.location.project_repository_id,
        source_path: context.source_path,
        source_branch: context.source_branch,
        target_scope: context.target_scope,
        target_workspace_id: context.target_workspace_id,
        target_path: context.target_path,
        target_branch: context.target_branch,
        source_head: context.source_head,
        parent_head: context.parent_head,
        before_head,
        result_head: None,
        recovery_ref,
        status: "active".into(),
        phase: "prepared".into(),
        resolver_session_id: None,
        delivery_operation_id: delivery_operation_id.map(str::to_owned),
        error: String::new(),
        started_at: timestamp.clone(),
        updated_at: timestamp,
        completed_at: None,
    };
    if let Err(error) = state.store.create_parent_operation(&operation).await {
        let _ = delete_recovery_ref(&context.repository.path, &operation.recovery_ref);
        return Err(error);
    }
    execute_parent_operation(state, &operation).await
}

pub(super) async fn execute_parent_operation(
    state: &AppState,
    operation: &ParentOperation,
) -> Result<ParentOperation> {
    let incoming = if operation.direction == "update" {
        &operation.parent_head
    } else {
        &operation.source_head
    };
    let result = if operation.strategy == "squash" {
        super::squash_delivery::execute(operation)
    } else if operation.strategy == "rebase" {
        git_rebase_output(Path::new(&operation.target_path), &[incoming])
    } else {
        command_output(
            Path::new(&operation.target_path),
            "git",
            &["merge", "--ff", "--no-edit", incoming],
        )
    };
    match result {
        Ok(_) => {
            reconcile_parent_operation(state, &state.store.parent_operation(&operation.id).await?)
                .await
        }
        Err(error)
            if git_operation_in_progress(&operation.target_path)?
                || has_unmerged_paths(&operation.target_path)?
                || (operation.strategy == "squash"
                    && !command_output(
                        Path::new(&operation.target_path),
                        "git",
                        &["status", "--porcelain"],
                    )
                    .map_err(AppError::BadRequest)?
                    .is_empty()) =>
        {
            state
                .store
                .update_parent_operation(ParentOperationUpdate {
                    id: &operation.id,
                    status: "conflicted",
                    phase: "conflicted",
                    result_head: None,
                    error: &error,
                    terminal: false,
                })
                .await?;
            state.store.parent_operation(&operation.id).await
        }
        Err(error) => {
            if git_head(&operation.target_path)? == operation.before_head {
                delete_recovery_ref(
                    &state
                        .store
                        .repository_as_directory(&operation.source_repository_id)
                        .await?
                        .path,
                    &operation.recovery_ref,
                )?;
                state
                    .store
                    .update_parent_operation(ParentOperationUpdate {
                        id: &operation.id,
                        status: "failed",
                        phase: "failed",
                        result_head: None,
                        error: &error,
                        terminal: true,
                    })
                    .await?;
                Err(AppError::BadRequest(error))
            } else {
                state
                    .store
                    .update_parent_operation(ParentOperationUpdate {
                        id: &operation.id,
                        status: "recovery_required",
                        phase: "command_failed_after_head_moved",
                        result_head: None,
                        error: &error,
                        terminal: false,
                    })
                    .await?;
                state.store.parent_operation(&operation.id).await
            }
        }
    }
}

pub(super) async fn reconcile_parent_operation(
    state: &AppState,
    operation: &ParentOperation,
) -> Result<ParentOperation> {
    if matches!(
        operation.status.as_str(),
        "completed" | "aborted" | "undone" | "failed"
    ) {
        if operation.status == "completed" {
            release_parent_operation_recovery(state, operation).await?;
        }
        return Ok(operation.clone());
    }
    if operation.strategy == "squash" {
        return super::squash_delivery::reconcile(state, operation).await;
    }
    if git_operation_in_progress(&operation.target_path)? {
        let conflicted = has_unmerged_paths(&operation.target_path)?;
        let status = if operation.status == "resolving" {
            "resolving"
        } else if conflicted {
            "conflicted"
        } else {
            "active"
        };
        let phase = if operation.status == "resolving" {
            "resolving"
        } else if conflicted {
            "conflicted"
        } else {
            "running"
        };
        state
            .store
            .update_parent_operation(ParentOperationUpdate {
                id: &operation.id,
                status,
                phase,
                result_head: None,
                error: if conflicted {
                    "Git has unresolved conflicts"
                } else {
                    ""
                },
                terminal: false,
            })
            .await?;
        return state.store.parent_operation(&operation.id).await;
    }
    let current_branch = command_output(
        Path::new(&operation.target_path),
        "git",
        &["branch", "--show-current"],
    )
    .map_err(AppError::BadRequest)?;
    let current_head = git_head(&operation.target_path)?;
    if current_branch != operation.target_branch {
        state
            .store
            .update_parent_operation(ParentOperationUpdate {
                id: &operation.id,
                status: "recovery_required",
                phase: "branch_moved",
                result_head: None,
                error: &format!(
                    "expected branch {}, found {}",
                    operation.target_branch, current_branch
                ),
                terminal: false,
            })
            .await?;
        return state.store.parent_operation(&operation.id).await;
    }
    let incoming = if operation.direction == "update" {
        &operation.parent_head
    } else {
        &operation.source_head
    };
    let valid = git_is_ancestor(&operation.target_path, incoming, &current_head)?
        && (operation.strategy == "rebase"
            || git_is_ancestor(
                &operation.target_path,
                &operation.before_head,
                &current_head,
            )?);
    let diverged = !git_is_ancestor(&operation.target_path, &operation.before_head, incoming)?
        && !git_is_ancestor(&operation.target_path, incoming, &operation.before_head)?;
    let merge_parents_valid = if operation.strategy == "merge" && diverged {
        let parents = command_output(
            Path::new(&operation.target_path),
            "git",
            &["show", "-s", "--format=%P", &current_head],
        )
        .map_err(AppError::BadRequest)?;
        let parents = parents.split_whitespace().collect::<Vec<_>>();
        parents.len() == 2
            && parents.contains(&operation.before_head.as_str())
            && parents.contains(&incoming.as_str())
    } else {
        true
    };
    if valid && merge_parents_valid && !has_unmerged_paths(&operation.target_path)? {
        state
            .store
            .update_parent_operation(ParentOperationUpdate {
                id: &operation.id,
                status: "completed",
                phase: "completed",
                result_head: Some(&current_head),
                error: "",
                terminal: true,
            })
            .await?;
    } else if current_head == operation.before_head
        && matches!(operation.status.as_str(), "conflicted" | "resolving")
    {
        state
            .store
            .update_parent_operation(ParentOperationUpdate {
                id: &operation.id,
                status: "aborted",
                phase: "aborted",
                result_head: None,
                error: "",
                terminal: true,
            })
            .await?;
    } else {
        state
            .store
            .update_parent_operation(ParentOperationUpdate {
                id: &operation.id,
                status: "recovery_required",
                phase: "verification_failed",
                result_head: Some(&current_head),
                error: "Git operation ended but the fixed heads or merge parents do not match",
                terminal: false,
            })
            .await?;
    }
    let current = state.store.parent_operation(&operation.id).await?;
    if current.status == "completed" {
        release_parent_operation_recovery(state, &current).await?;
    }
    Ok(current)
}

pub(super) async fn abort_parent_operation_impl(
    state: &AppState,
    operation: &ParentOperation,
) -> Result<ParentOperation> {
    let operation = reconcile_parent_operation(state, operation).await?;
    if matches!(operation.status.as_str(), "aborted" | "undone" | "failed") {
        return Ok(operation);
    }
    if operation.status == "completed" {
        return Err(AppError::BadRequest(
            "completed operations cannot be aborted".into(),
        ));
    }
    ensure_checked_out_branch(
        &operation.target_path,
        &operation.target_branch,
        "operation target",
    )?;
    if operation.strategy == "squash" && git_head(&operation.target_path)? != operation.before_head
    {
        return Err(AppError::BadRequest(
            "Squash target moved; abort cannot overwrite newer commits".into(),
        ));
    }
    if git_operation_in_progress(&operation.target_path)? {
        let args = if operation.strategy == "rebase" {
            ["rebase", "--abort"]
        } else {
            ["merge", "--abort"]
        };
        command_output(Path::new(&operation.target_path), "git", &args)
            .map_err(|error| AppError::BadRequest(format!("abort Git operation: {error}")))?;
    }
    command_output(
        Path::new(&operation.target_path),
        "git",
        &["reset", "--hard", &operation.before_head],
    )
    .map_err(|error| AppError::BadRequest(format!("restore recovery point: {error}")))?;
    if git_head(&operation.target_path)? != operation.before_head {
        return Err(AppError::BadRequest(
            "abort did not restore the fixed before HEAD".into(),
        ));
    }
    delete_recovery_ref(
        &state
            .store
            .repository_as_directory(&operation.source_repository_id)
            .await?
            .path,
        &operation.recovery_ref,
    )?;
    state
        .store
        .update_parent_operation(ParentOperationUpdate {
            id: &operation.id,
            status: "aborted",
            phase: "aborted",
            result_head: None,
            error: "",
            terminal: true,
        })
        .await?;
    state.store.parent_operation(&operation.id).await
}

pub(super) async fn release_parent_operation_recovery(
    state: &AppState,
    operation: &ParentOperation,
) -> Result<()> {
    delete_recovery_ref(
        &state
            .store
            .repository_as_directory(&operation.source_repository_id)
            .await?
            .path,
        &operation.recovery_ref,
    )?;
    Ok(())
}

pub(super) async fn parent_operation_outcome(
    path: &str,
    current: &str,
    incoming: &str,
) -> Result<String> {
    if current == incoming || git_is_ancestor(path, incoming, current)? {
        Ok("up_to_date".into())
    } else if git_is_ancestor(path, current, incoming)? {
        Ok("fast_forward".into())
    } else {
        Ok("merge_commit".into())
    }
}

pub(super) fn git_status_porcelain(path: &str) -> Result<String> {
    command_output(Path::new(path), "git", &["status", "--porcelain"]).map_err(AppError::BadRequest)
}

pub(super) fn git_operation_in_progress(path: &str) -> Result<bool> {
    if rebase_in_progress(path)? {
        return Ok(true);
    }
    for marker in ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD"] {
        let marker_path =
            command_output(Path::new(path), "git", &["rev-parse", "--git-path", marker])
                .map_err(AppError::BadRequest)?;
        let marker_path = PathBuf::from(marker_path);
        let absolute = if marker_path.is_absolute() {
            marker_path
        } else {
            Path::new(path).join(marker_path)
        };
        if absolute.exists() {
            return Ok(true);
        }
    }
    Ok(false)
}

pub(super) fn unmerged_paths(path: &str) -> Result<Vec<String>> {
    let output = command_output(
        Path::new(path),
        "git",
        &["diff", "--name-only", "--diff-filter=U"],
    )
    .map_err(AppError::BadRequest)?;
    Ok(output
        .lines()
        .filter(|line| !line.is_empty())
        .map(str::to_owned)
        .collect())
}
