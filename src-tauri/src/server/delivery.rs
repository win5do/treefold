async fn get_workspace_location_rebase(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Option<RebaseOperation>>> {
    state.store.workspace_location(&id)?;
    Ok(Json(state.store.latest_rebase_operation(&id)?))
}

async fn update_workspace_location_rebase(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<RebaseInput>,
) -> Result<Json<RebaseOperation>> {
    blocking_git_operation(move || update_workspace_location_rebase_impl(state, id, input)).await
}

fn update_workspace_location_rebase_impl(
    state: AppState,
    id: String,
    input: RebaseInput,
) -> Result<Json<RebaseOperation>> {
    let location = state.store.workspace_location(&id)?;
    let path = workspace_location_git_path(&location)?.to_owned();
    let project_location = state.store.directory(&location.project_location_id)?;
    let operation = match input.action.as_str() {
        "start" => {
            ensure_clean_workspace(&path, "Workspace location")?;
            ensure_checked_out_branch(
                &path,
                location.branch.as_deref().unwrap_or(""),
                "Workspace location",
            )?;
            let workspace = state.store.workspace(&location.workspace_id)?;
            let (target_path, _) =
                workspace_location_delivery_target(&state, &workspace, &location)?;
            let before_head = git_head(&path)?;
            let target_head = git_head(&target_path)?;
            let operation_id = id_for_operation();
            let recovery_ref = format!("refs/treefold/recovery/rebase-{operation_id}");
            command_output(
                Path::new(&project_location.path),
                "git",
                &["update-ref", &recovery_ref, &before_head],
            )
            .map_err(AppError::BadRequest)?;
            let timestamp = now();
            let mut operation = RebaseOperation {
                id: operation_id,
                workspace_location_id: id.clone(),
                workspace_id: location.workspace_id.clone(),
                status: "active".into(),
                phase: "rebasing".into(),
                before_head,
                target_head: target_head.clone(),
                rebased_head: None,
                recovery_ref,
                error: String::new(),
                started_at: timestamp.clone(),
                updated_at: timestamp,
                completed_at: None,
            };
            state.store.create_rebase_operation(&operation)?;
            match git_rebase_output(Path::new(&path), &[&target_head]) {
                Ok(_) => {
                    let head = git_head(&path)?;
                    state.store.update_rebase_operation(
                        &operation.id,
                        "completed",
                        "completed",
                        Some(&head),
                        "",
                        true,
                    )?;
                    operation = state
                        .store
                        .latest_rebase_operation(&id)?
                        .expect("rebase operation exists");
                }
                Err(error) if rebase_in_progress(&path)? => {
                    state.store.update_rebase_operation(
                        &operation.id,
                        "conflicts",
                        "conflicts",
                        None,
                        &error,
                        false,
                    )?;
                    operation = state
                        .store
                        .latest_rebase_operation(&id)?
                        .expect("rebase operation exists");
                }
                Err(error) => {
                    state.store.update_rebase_operation(
                        &operation.id,
                        "failed",
                        "failed",
                        None,
                        &error,
                        true,
                    )?;
                    return Err(AppError::BadRequest(error));
                }
            }
            operation
        }
        "continue" | "abort" => {
            let current = state.store.latest_rebase_operation(&id)?.ok_or_else(|| {
                AppError::BadRequest("no rebase operation exists for this location".into())
            })?;
            let result = if input.action == "continue" {
                git_rebase_output(Path::new(&path), &["--continue"])
            } else {
                git_rebase_output(Path::new(&path), &["--abort"])
            };
            match result {
                Ok(_) => {
                    let status = if input.action == "continue" {
                        "completed"
                    } else {
                        "aborted"
                    };
                    let head = git_head(&path)?;
                    state.store.update_rebase_operation(
                        &current.id,
                        status,
                        status,
                        Some(&head),
                        "",
                        true,
                    )?;
                }
                Err(error) => {
                    state.store.update_rebase_operation(
                        &current.id,
                        "conflicts",
                        "conflicts",
                        None,
                        &error,
                        false,
                    )?;
                    return Err(AppError::BadRequest(error));
                }
            }
            state
                .store
                .latest_rebase_operation(&id)?
                .expect("rebase operation exists")
        }
        _ => {
            return Err(AppError::BadRequest(
                "rebase action must be start, continue, or abort".into(),
            ))
        }
    };
    Ok(Json(operation))
}

async fn get_workspace_location_reset(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Option<ResetOperation>>> {
    state.store.workspace_location(&id)?;
    Ok(Json(state.store.latest_reset_operation(&id)?))
}

async fn reset_workspace_location(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<ResetWorkspace>,
) -> Result<(StatusCode, Json<ResetOperation>)> {
    blocking_git_operation(move || reset_workspace_location_impl(state, id, input)).await
}

fn reset_workspace_location_impl(
    state: AppState,
    id: String,
    input: ResetWorkspace,
) -> Result<(StatusCode, Json<ResetOperation>)> {
    if !input.confirm {
        return Err(AppError::BadRequest(
            "confirm must be true for reset".into(),
        ));
    }
    let location = state.store.workspace_location(&id)?;
    let path = workspace_location_git_path(&location)?.to_owned();
    ensure_clean_workspace(&path, "Workspace location")?;
    let revision = match input.mode.as_str() {
        "creation" => location
            .start_commit
            .clone()
            .ok_or_else(|| AppError::BadRequest("location has no start commit".into()))?,
        "target" => location
            .base_branch
            .clone()
            .ok_or_else(|| AppError::BadRequest("location has no base branch".into()))?,
        "commit" => input
            .commit
            .clone()
            .filter(|v| !v.trim().is_empty())
            .ok_or_else(|| AppError::BadRequest("commit is required".into()))?,
        _ => {
            return Err(AppError::BadRequest(
                "reset mode must be creation, target, or commit".into(),
            ))
        }
    };
    let target_head = resolve_commit(&path, &revision)?;
    let before_head = git_head(&path)?;
    let project_location = state.store.directory(&location.project_location_id)?;
    let operation_id = id_for_operation();
    let recovery_ref = format!("refs/treefold/recovery/reset-{operation_id}");
    command_output(
        Path::new(&project_location.path),
        "git",
        &["update-ref", &recovery_ref, &before_head],
    )
    .map_err(AppError::BadRequest)?;
    let timestamp = now();
    let operation = ResetOperation {
        id: operation_id,
        workspace_location_id: id.clone(),
        workspace_id: location.workspace_id,
        status: "active".into(),
        mode: input.mode,
        before_head,
        target_head: target_head.clone(),
        result_head: None,
        recovery_ref,
        error: String::new(),
        started_at: timestamp.clone(),
        updated_at: timestamp,
        completed_at: None,
    };
    state.store.create_reset_operation(&operation)?;
    command_output(Path::new(&path), "git", &["reset", "--hard", &target_head])
        .map_err(AppError::BadRequest)?;
    let result_head = git_head(&path)?;
    state
        .store
        .update_reset_operation(&operation.id, "completed", Some(&result_head), "", true)?;
    Ok((
        StatusCode::CREATED,
        Json(state.store.reset_operation(&operation.id)?),
    ))
}

async fn restore_workspace_location_reset(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<RestoreReset>,
) -> Result<Json<ResetOperation>> {
    blocking_git_operation(move || restore_workspace_location_reset_impl(state, id, input)).await
}

fn restore_workspace_location_reset_impl(
    state: AppState,
    id: String,
    input: RestoreReset,
) -> Result<Json<ResetOperation>> {
    if !input.confirm {
        return Err(AppError::BadRequest(
            "confirm must be true for restore".into(),
        ));
    }
    let location = state.store.workspace_location(&id)?;
    let path = workspace_location_git_path(&location)?.to_owned();
    ensure_clean_workspace(&path, "Workspace location")?;
    let operation = state.store.reset_operation(&input.operation_id)?;
    if operation.workspace_location_id != id {
        return Err(AppError::BadRequest(
            "reset operation does not belong to this location".into(),
        ));
    }
    command_output(
        Path::new(&path),
        "git",
        &["reset", "--hard", &operation.before_head],
    )
    .map_err(AppError::BadRequest)?;
    let head = git_head(&path)?;
    state
        .store
        .update_reset_operation(&operation.id, "restored", Some(&head), "", true)?;
    Ok(Json(state.store.reset_operation(&operation.id)?))
}


async fn finish_workspace_location(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<FinishWorkspace>,
) -> Result<Json<WorkspaceLocation>> {
    blocking_git_operation(move || finish_workspace_location_impl(state, id, input)).await
}

fn finish_workspace_location_impl(
    state: AppState,
    id: String,
    input: FinishWorkspace,
) -> Result<Json<WorkspaceLocation>> {
    validate_delivery_input(&input)?;
    let location = state.store.workspace_location(&id)?;
    let workspace = state.store.workspace(&location.workspace_id)?;
    if location.access_mode != "read_write" {
        return Err(AppError::BadRequest(
            "read-only locations do not require Finish".into(),
        ));
    }
    if !matches!(location.delivery_status.as_str(), "active" | "failed") {
        return Ok(Json(location));
    }
    if let Some(preflight_id) = input.preflight_id.as_deref() {
        let preflight = state.store.delivery_preflight(preflight_id)?;
        if preflight.workspace_location_id != location.id
            || preflight.code_action != input.code_action
        {
            return Err(AppError::BadRequest(
                "preflight does not match this Workspace location".into(),
            ));
        }
        if !preflight.blockers.is_empty() {
            return Err(AppError::BadRequest("delivery preflight is blocked".into()));
        }
    }
    let source_path = workspace_location_git_path(&location)?.to_owned();
    let branch = location
        .branch
        .as_deref()
        .ok_or_else(|| AppError::BadRequest("Workspace location has no branch".into()))?
        .to_owned();
    ensure_checked_out_branch(&source_path, &branch, "Workspace location")?;
    if !command_output(Path::new(&source_path), "git", &["status", "--porcelain"])
        .unwrap_or_default()
        .is_empty()
    {
        let message = trimmed(input.commit_message.clone())
            .filter(|v| !v.is_empty())
            .ok_or_else(|| {
                AppError::BadRequest("commit_message is required for uncommitted changes".into())
            })?;
        command_output(Path::new(&source_path), "git", &["add", "-A"])
            .map_err(AppError::BadRequest)?;
        command_output(Path::new(&source_path), "git", &["commit", "-m", &message])
            .map_err(AppError::BadRequest)?;
    }
    let source_head = git_head(&source_path)?;
    let (status, outcome, integrated) = match input.code_action.as_str() {
        "local_merge" => {
            let (target_path, target_branch) =
                workspace_location_delivery_target(&state, &workspace, &location)?;
            ensure_clean_workspace(&target_path, "merge target")?;
            ensure_checked_out_branch(&target_path, &target_branch, "merge target")?;
            command_output(
                Path::new(&target_path),
                "git",
                &["merge", "--no-ff", &source_head],
            )
            .map_err(AppError::BadRequest)?;
            let head = git_head(&target_path)?;
            ("delivered", "local_merge", Some(head))
        }
        "remote_merged" => ("remote_merged", "remote_merged", Some(source_head.clone())),
        "keep" => ("kept", "keep", Some(source_head.clone())),
        "discard" => ("discarded", "discard", None),
        _ => unreachable!(),
    };
    if input.delete_worktree || input.code_action == "discard" {
        let project_location = state.store.directory(&location.project_location_id)?;
        remove_worktree_if_present(&project_location.path, &source_path)?;
        if input.delete_branch || input.code_action == "discard" {
            let target = location.base_branch.as_deref().unwrap_or("HEAD");
            delete_delivered_branch_if_present(
                &project_location.path,
                &branch,
                target,
                &source_head,
                input.code_action != "discard",
            )?;
        }
    }
    let timestamp = now();
    state.store.finish_workspace_location(
        &location.id,
        status,
        outcome,
        integrated.as_deref(),
        &timestamp,
    )?;
    Ok(Json(state.store.workspace_location(&location.id)?))
}

fn workspace_location_delivery_target(
    state: &AppState,
    workspace: &Workspace,
    location: &WorkspaceLocation,
) -> Result<(String, String)> {
    if let Some(parent_id) = workspace.parent_workspace_id.as_deref() {
        let parent = state
            .store
            .workspace_locations(parent_id)?
            .into_iter()
            .find(|item| item.project_location_id == location.project_location_id)
            .ok_or_else(|| {
                AppError::BadRequest("parent Workspace does not contain this location".into())
            })?;
        return Ok((
            workspace_location_git_path(&parent)?.into(),
            parent.branch.unwrap_or_default(),
        ));
    }
    let project_location = state.store.directory(&location.project_location_id)?;
    ensure_location_ready(&project_location)?;
    Ok((
        project_location.path,
        location
            .base_branch
            .clone()
            .ok_or_else(|| AppError::BadRequest("Workspace location has no base branch".into()))?,
    ))
}


#[derive(Deserialize)]
struct RebaseInput {
    action: String,
}

async fn get_rebase_status(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Option<RebaseOperation>>> {
    Ok(Json(rebase_status_impl(&state, &id)?))
}

async fn update_rebase(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<RebaseInput>,
) -> Result<Json<RebaseOperation>> {
    blocking_git_operation(move || {
        let operation = match input.action.as_str() {
            "start" => start_rebase(&state, &id),
            "continue" => continue_rebase(&state, &id),
            "abort" => abort_rebase(&state, &id),
            _ => Err(AppError::BadRequest(
                "rebase action must be start, continue, or abort".into(),
            )),
        }?;
        Ok(Json(operation))
    })
    .await
}

fn start_rebase(state: &AppState, id: &str) -> Result<RebaseOperation> {
    let (workspace, directory) = rebase_context(state, id)?;
    if state.store.delivery_operation(id)?.is_some() {
        return Err(AppError::BadRequest(
            "cannot rebase while delivery is in progress".into(),
        ));
    }
    if reset_status_impl(state, id)?.is_some_and(|operation| operation.status == "active") {
        return Err(AppError::BadRequest(
            "cannot rebase while reset recovery is required".into(),
        ));
    }
    if let Some(operation) = state.store.latest_rebase_operation(id)? {
        if rebase_operation_blocks(&operation) {
            return rebase_status_impl(state, id)?.ok_or_else(|| {
                AppError::Internal(anyhow::anyhow!("active rebase operation disappeared"))
            });
        }
    }

    ensure_clean_workspace(&workspace.checkout_path, "Workspace")?;
    ensure_checked_out_branch(&workspace.checkout_path, &workspace.branch, "Workspace")?;
    let before_head = git_head(&workspace.checkout_path)?;
    let target_head = command_output(
        Path::new(&directory.path),
        "git",
        &["rev-parse", "--verify", &workspace.target_branch],
    )
    .map_err(AppError::BadRequest)?;
    let operation_id = id_for_operation();
    let recovery_ref = format!("refs/treefold/recovery/rebase-{operation_id}");
    command_output(
        Path::new(&directory.path),
        "git",
        &["update-ref", &recovery_ref, &before_head],
    )
    .map_err(|error| AppError::BadRequest(format!("create rebase recovery ref: {error}")))?;

    let timestamp = now();
    let operation = RebaseOperation {
        id: operation_id,
        workspace_id: workspace.id.clone(),
        workspace_location_id: state.store.default_workspace_location(&workspace.id)?.id,
        status: "active".into(),
        phase: "prepared".into(),
        before_head,
        target_head,
        rebased_head: None,
        recovery_ref,
        error: String::new(),
        started_at: timestamp.clone(),
        updated_at: timestamp,
        completed_at: None,
    };
    if let Err(error) = state.store.create_rebase_operation(&operation) {
        let _ = delete_recovery_ref(&directory.path, &operation.recovery_ref);
        return Err(error);
    }
    execute_rebase(
        state,
        &workspace,
        &directory,
        &operation,
        &[&operation.target_head],
    )
}

fn continue_rebase(state: &AppState, id: &str) -> Result<RebaseOperation> {
    let operation = rebase_status_impl(state, id)?.ok_or_else(|| {
        AppError::BadRequest("no rebase operation exists for this Workspace".into())
    })?;
    if rebase_operation_is_final(&operation) {
        return Ok(operation);
    }
    let (workspace, directory) = rebase_context(state, id)?;
    if rebase_in_progress(&workspace.checkout_path)? {
        if has_unmerged_paths(&workspace.checkout_path)? {
            state.store.update_rebase_operation(
                &operation.id,
                "conflicted",
                "conflicted",
                None,
                "resolve and stage every conflicted path before continuing",
                false,
            )?;
            return latest_rebase_required(state, id);
        }
        execute_rebase(state, &workspace, &directory, &operation, &["--continue"])
    } else if git_head(&workspace.checkout_path)? == operation.before_head
        && matches!(operation.phase.as_str(), "prepared" | "rebasing")
    {
        execute_rebase(
            state,
            &workspace,
            &directory,
            &operation,
            &[&operation.target_head],
        )
    } else {
        Err(AppError::BadRequest(
            "rebase cannot continue because Git has no resumable rebase state; abort to restore the recovery point"
                .into(),
        ))
    }
}

fn abort_rebase(state: &AppState, id: &str) -> Result<RebaseOperation> {
    let operation = state.store.latest_rebase_operation(id)?.ok_or_else(|| {
        AppError::BadRequest("no rebase operation exists for this Workspace".into())
    })?;
    if rebase_operation_is_final(&operation) {
        return Ok(operation);
    }
    let (workspace, directory) = rebase_context(state, id)?;
    if rebase_in_progress(&workspace.checkout_path)? {
        git_rebase_output(Path::new(&workspace.checkout_path), &["--abort"]).map_err(|error| {
            let _ = state.store.update_rebase_operation(
                &operation.id,
                "failed",
                "abort_failed",
                None,
                &error,
                false,
            );
            AppError::BadRequest(format!("abort rebase: {error}"))
        })?;
    }
    command_output(
        Path::new(&workspace.checkout_path),
        "git",
        &["reset", "--hard", &operation.before_head],
    )
    .map_err(|error| AppError::BadRequest(format!("restore rebase recovery point: {error}")))?;
    let restored_head = git_head(&workspace.checkout_path)?;
    if restored_head != operation.before_head {
        return Err(AppError::BadRequest(format!(
            "rebase abort did not restore the original HEAD: expected {}, found {restored_head}",
            operation.before_head
        )));
    }
    delete_recovery_ref(&directory.path, &operation.recovery_ref)?;
    state
        .store
        .update_rebase_operation(&operation.id, "aborted", "aborted", None, "", true)?;
    latest_rebase_required(state, id)
}

fn rebase_status_impl(state: &AppState, id: &str) -> Result<Option<RebaseOperation>> {
    let Some(operation) = state.store.latest_rebase_operation(id)? else {
        let _ = rebase_context(state, id)?;
        return Ok(None);
    };
    if rebase_operation_is_final(&operation) {
        return Ok(Some(operation));
    }
    let (workspace, directory) = rebase_context(state, id)?;
    if rebase_in_progress(&workspace.checkout_path)? {
        let conflicted = has_unmerged_paths(&workspace.checkout_path)?;
        let status = if conflicted { "conflicted" } else { "active" };
        let phase = if conflicted { "conflicted" } else { "rebasing" };
        if operation.status != status || operation.phase != phase {
            state.store.update_rebase_operation(
                &operation.id,
                status,
                phase,
                None,
                if conflicted {
                    "rebase has unresolved conflicts"
                } else {
                    ""
                },
                false,
            )?;
        }
        return Ok(Some(latest_rebase_required(state, id)?));
    }

    let current_head = git_head(&workspace.checkout_path)?;
    if git_is_ancestor(
        &workspace.checkout_path,
        &operation.target_head,
        &current_head,
    )? {
        return Ok(Some(finalize_rebase(
            state, &workspace, &directory, &operation,
        )?));
    }
    if current_head == operation.before_head {
        if operation.status == "conflicted" || operation.phase == "conflicted" {
            delete_recovery_ref(&directory.path, &operation.recovery_ref)?;
            state.store.update_rebase_operation(
                &operation.id,
                "aborted",
                "aborted",
                None,
                "",
                true,
            )?;
            return Ok(Some(latest_rebase_required(state, id)?));
        }
        return Ok(Some(operation));
    }

    let error = format!(
        "Git rebase state is missing and HEAD {} matches neither the recovery point nor a commit based on {}",
        current_head, operation.target_head
    );
    state.store.update_rebase_operation(
        &operation.id,
        "failed",
        "recovery_required",
        Some(&current_head),
        &error,
        false,
    )?;
    Ok(Some(latest_rebase_required(state, id)?))
}

fn execute_rebase(
    state: &AppState,
    workspace: &Workspace,
    directory: &Directory,
    operation: &RebaseOperation,
    args: &[&str],
) -> Result<RebaseOperation> {
    state
        .store
        .update_rebase_operation(&operation.id, "active", "rebasing", None, "", false)?;
    match git_rebase_output(Path::new(&workspace.checkout_path), args) {
        Ok(_) => finalize_rebase(state, workspace, directory, operation),
        Err(error) if rebase_in_progress(&workspace.checkout_path)? => {
            state.store.update_rebase_operation(
                &operation.id,
                "conflicted",
                "conflicted",
                None,
                &error,
                false,
            )?;
            latest_rebase_required(state, &workspace.id)
        }
        Err(error) => {
            state.store.update_rebase_operation(
                &operation.id,
                "failed",
                "failed",
                git_head(&workspace.checkout_path).ok().as_deref(),
                &error,
                false,
            )?;
            Err(AppError::BadRequest(format!("rebase failed: {error}")))
        }
    }
}

fn finalize_rebase(
    state: &AppState,
    workspace: &Workspace,
    directory: &Directory,
    operation: &RebaseOperation,
) -> Result<RebaseOperation> {
    let rebased_head = git_head(&workspace.checkout_path)?;
    if !git_is_ancestor(
        &workspace.checkout_path,
        &operation.target_head,
        &rebased_head,
    )? {
        let error = "rebase finished but the fixed target commit is not an ancestor of HEAD";
        state.store.update_rebase_operation(
            &operation.id,
            "failed",
            "verification_failed",
            Some(&rebased_head),
            error,
            false,
        )?;
        return Err(AppError::BadRequest(error.into()));
    }
    delete_recovery_ref(&directory.path, &operation.recovery_ref)?;
    state.store.update_rebase_operation(
        &operation.id,
        "completed",
        "completed",
        Some(&rebased_head),
        "",
        true,
    )?;
    latest_rebase_required(state, &workspace.id)
}

fn rebase_context(state: &AppState, id: &str) -> Result<(Workspace, Directory)> {
    let workspace = state.store.workspace(id)?;
    if workspace.status != "active" || workspace.kind == "base" || workspace.branch.is_empty() {
        return Err(AppError::BadRequest(
            "rebase is available only for an active managed Workspace".into(),
        ));
    }
    let directory = state.store.directory(&workspace.project_directory_id)?;
    ensure_git_directory(&directory)?;
    Ok((workspace, directory))
}

fn latest_rebase_required(state: &AppState, id: &str) -> Result<RebaseOperation> {
    state
        .store
        .latest_rebase_operation(id)?
        .ok_or_else(|| AppError::Internal(anyhow::anyhow!("rebase operation disappeared")))
}

fn rebase_operation_is_final(operation: &RebaseOperation) -> bool {
    matches!(operation.status.as_str(), "completed" | "aborted")
}

fn rebase_operation_blocks(operation: &RebaseOperation) -> bool {
    !rebase_operation_is_final(operation)
}

fn id_for_operation() -> String {
    Uuid::new_v4().simple().to_string()
}

fn rebase_in_progress(workspace: &str) -> Result<bool> {
    for name in ["rebase-merge", "rebase-apply"] {
        let path = command_output(
            Path::new(workspace),
            "git",
            &["rev-parse", "--git-path", name],
        )
        .map_err(AppError::BadRequest)?;
        let path = PathBuf::from(path);
        let path = if path.is_absolute() {
            path
        } else {
            Path::new(workspace).join(path)
        };
        if path.exists() {
            return Ok(true);
        }
    }
    Ok(false)
}

fn has_unmerged_paths(workspace: &str) -> Result<bool> {
    let paths = command_output(
        Path::new(workspace),
        "git",
        &["diff", "--name-only", "--diff-filter=U"],
    )
    .map_err(AppError::BadRequest)?;
    Ok(!paths.is_empty())
}

fn git_is_ancestor(workspace: &str, ancestor: &str, descendant: &str) -> Result<bool> {
    let status = git::status(
        Path::new(workspace),
        &["merge-base", "--is-ancestor", ancestor, descendant],
    )
    .map_err(|error| AppError::BadRequest(format!("git merge-base: {error}")))?;
    match status.code() {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        _ => Err(AppError::BadRequest(
            "git could not compare the rebase commits".into(),
        )),
    }
}

async fn git_is_ancestor_async(workspace: &str, ancestor: &str, descendant: &str) -> Result<bool> {
    let status = git::status_async(
        Path::new(workspace),
        &["merge-base", "--is-ancestor", ancestor, descendant],
    )
    .await
    .map_err(|error| AppError::BadRequest(format!("git merge-base: {error}")))?;
    match status.code() {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        _ => Err(AppError::BadRequest(
            "git could not compare the rebase commits".into(),
        )),
    }
}

fn delete_recovery_ref(repository: &str, recovery_ref: &str) -> Result<()> {
    command_output(
        Path::new(repository),
        "git",
        &["update-ref", "-d", recovery_ref],
    )
    .map_err(|error| AppError::BadRequest(format!("delete recovery ref: {error}")))?;
    Ok(())
}

fn git_rebase_output(dir: &Path, args: &[&str]) -> std::result::Result<String, String> {
    let mut command_args = Vec::with_capacity(args.len() + 1);
    command_args.push("rebase");
    command_args.extend_from_slice(args);
    git::output_with_env(
        dir,
        &command_args,
        &[("GIT_EDITOR", "true"), ("GIT_SEQUENCE_EDITOR", "true")],
    )
}

#[derive(Deserialize)]
struct ResetWorkspace {
    mode: String,
    commit: Option<String>,
    confirm: bool,
}

#[derive(Deserialize)]
struct RestoreReset {
    operation_id: String,
    confirm: bool,
}

async fn reset_workspace(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<ResetWorkspace>,
) -> Result<(StatusCode, Json<ResetOperation>)> {
    blocking_git_operation(move || {
        start_reset(&state, &id, &input).map(|operation| (StatusCode::CREATED, Json(operation)))
    })
    .await
}

async fn get_reset_status(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Option<ResetOperation>>> {
    reset_status_impl(&state, &id).map(Json)
}

async fn restore_workspace_reset(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<RestoreReset>,
) -> Result<Json<ResetOperation>> {
    blocking_git_operation(move || restore_reset(&state, &id, &input).map(Json)).await
}

fn start_reset(state: &AppState, id: &str, input: &ResetWorkspace) -> Result<ResetOperation> {
    if !input.confirm {
        return Err(AppError::BadRequest(
            "reset requires explicit confirmation".into(),
        ));
    }
    if !["creation", "target", "commit"].contains(&input.mode.as_str()) {
        return Err(AppError::BadRequest(
            "reset mode must be creation, target, or commit".into(),
        ));
    }
    let (workspace, directory) = reset_context(state, id)?;
    let _ = reset_status_impl(state, id)?;
    ensure_no_git_operation_in_progress(state, id, "reset")?;
    ensure_clean_workspace(&workspace.checkout_path, "reset workspace")?;
    ensure_checked_out_branch(
        &workspace.checkout_path,
        &workspace.branch,
        "reset workspace",
    )?;

    let revision = match input.mode.as_str() {
        "creation" => workspace.start_commit.clone(),
        "target" => workspace.target_branch.clone(),
        "commit" => input
            .commit
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| AppError::BadRequest("commit is required for commit reset mode".into()))?
            .to_owned(),
        _ => unreachable!(),
    };
    let target_head = resolve_commit(&directory.path, &revision)?;
    let before_head = git_head(&workspace.checkout_path)?;
    let operation_id = id_for_operation();
    let recovery_ref = format!("refs/treefold/recovery/reset-{operation_id}");
    command_output(
        Path::new(&directory.path),
        "git",
        &["update-ref", &recovery_ref, &before_head],
    )
    .map_err(|error| AppError::BadRequest(format!("create reset recovery ref: {error}")))?;
    let timestamp = now();
    let operation = ResetOperation {
        id: operation_id,
        workspace_id: id.to_owned(),
        workspace_location_id: state.store.default_workspace_location(id)?.id,
        status: "active".into(),
        mode: input.mode.clone(),
        before_head,
        target_head: target_head.clone(),
        result_head: None,
        recovery_ref,
        error: String::new(),
        started_at: timestamp.clone(),
        updated_at: timestamp,
        completed_at: None,
    };
    if let Err(error) = state.store.create_reset_operation(&operation) {
        let _ = delete_recovery_ref(&directory.path, &operation.recovery_ref);
        return Err(error);
    }
    if let Err(error) = command_output(
        Path::new(&workspace.checkout_path),
        "git",
        &["reset", "--hard", &target_head],
    ) {
        state
            .store
            .update_reset_operation(&operation.id, "failed", None, &error, true)?;
        return Err(AppError::BadRequest(format!(
            "reset failed; recovery ref was preserved: {error}"
        )));
    }
    let result_head = git_head(&workspace.checkout_path)?;
    if result_head != target_head {
        let error =
            format!("reset finished at unexpected HEAD {result_head}; expected {target_head}");
        state.store.update_reset_operation(
            &operation.id,
            "failed",
            Some(&result_head),
            &error,
            true,
        )?;
        return Err(AppError::BadRequest(error));
    }
    state
        .store
        .update_reset_operation(&operation.id, "completed", Some(&result_head), "", true)?;
    state.store.reset_operation(&operation.id)
}

fn restore_reset(state: &AppState, id: &str, input: &RestoreReset) -> Result<ResetOperation> {
    if !input.confirm {
        return Err(AppError::BadRequest(
            "reset restore requires explicit confirmation".into(),
        ));
    }
    let (workspace, directory) = reset_context(state, id)?;
    let operation = state.store.reset_operation(&input.operation_id)?;
    if operation.workspace_location_id != state.store.default_workspace_location(id)?.id {
        return Err(AppError::BadRequest(
            "reset operation does not belong to this Workspace".into(),
        ));
    }
    if operation.status == "restored" {
        return Ok(operation);
    }
    if !["completed", "failed"].contains(&operation.status.as_str()) {
        return Err(AppError::BadRequest(format!(
            "only a completed or failed reset can be restored; current status is {}",
            operation.status
        )));
    }
    let latest = state
        .store
        .latest_reset_operation(id)?
        .ok_or_else(|| AppError::Internal(anyhow::anyhow!("reset operation disappeared")))?;
    if latest.id != operation.id {
        return Err(AppError::BadRequest(
            "only the latest reset operation can be restored".into(),
        ));
    }
    ensure_no_git_operation_in_progress(state, id, "restore reset")?;
    ensure_clean_workspace(&workspace.checkout_path, "reset workspace")?;
    let current_head = git_head(&workspace.checkout_path)?;
    if current_head == operation.before_head {
        state
            .store
            .update_reset_operation(&operation.id, "restored", None, "", true)?;
        delete_recovery_ref(&directory.path, &operation.recovery_ref)?;
        return state.store.reset_operation(&operation.id);
    }
    let expected_current = operation.result_head.as_deref() == Some(current_head.as_str())
        || (operation.status == "failed" && current_head == operation.target_head);
    if !expected_current {
        return Err(AppError::BadRequest(
            "reset cannot be restored because HEAD moved after the operation".into(),
        ));
    }
    command_output(
        Path::new(&workspace.checkout_path),
        "git",
        &["reset", "--hard", &operation.recovery_ref],
    )
    .map_err(|error| AppError::BadRequest(format!("restore reset recovery point: {error}")))?;
    let restored_head = git_head(&workspace.checkout_path)?;
    if restored_head != operation.before_head {
        return Err(AppError::BadRequest(format!(
            "reset restore finished at unexpected HEAD {restored_head}"
        )));
    }
    state
        .store
        .update_reset_operation(&operation.id, "restored", None, "", true)?;
    delete_recovery_ref(&directory.path, &operation.recovery_ref)?;
    state.store.reset_operation(&operation.id)
}

fn reset_status_impl(state: &AppState, id: &str) -> Result<Option<ResetOperation>> {
    let Some(operation) = state.store.latest_reset_operation(id)? else {
        let _ = reset_context(state, id)?;
        return Ok(None);
    };
    if operation.status != "active" {
        return Ok(Some(operation));
    }
    let (workspace, _) = reset_context(state, id)?;
    let current_head = git_head(&workspace.checkout_path)?;
    if current_head == operation.target_head {
        state.store.update_reset_operation(
            &operation.id,
            "completed",
            Some(&current_head),
            "",
            true,
        )?;
    } else if current_head == operation.before_head {
        state.store.update_reset_operation(
            &operation.id,
            "failed",
            None,
            "reset was interrupted before changing HEAD; retry the reset",
            true,
        )?;
    } else {
        state.store.update_reset_operation(
            &operation.id,
            "failed",
            Some(&current_head),
            "reset was interrupted at an unexpected HEAD; the recovery ref was preserved",
            true,
        )?;
    }
    Ok(Some(state.store.reset_operation(&operation.id)?))
}

fn reset_context(state: &AppState, id: &str) -> Result<(Workspace, Directory)> {
    let workspace = state.store.workspace(id)?;
    if workspace.status != "active" || workspace.kind == "base" || workspace.branch.is_empty() {
        return Err(AppError::BadRequest(
            "reset is available only for an active managed Workspace".into(),
        ));
    }
    let directory = state.store.directory(&workspace.project_directory_id)?;
    ensure_git_directory(&directory)?;
    Ok((workspace, directory))
}

fn ensure_no_git_operation_in_progress(state: &AppState, id: &str, action: &str) -> Result<()> {
    if state.store.delivery_operation(id)?.is_some() {
        return Err(AppError::BadRequest(format!(
            "cannot {action} while delivery is in progress"
        )));
    }
    if let Some(rebase) = state.store.latest_rebase_operation(id)? {
        if rebase_operation_blocks(&rebase) {
            return Err(AppError::BadRequest(format!(
                "cannot {action} while rebase is {}",
                rebase.status
            )));
        }
    }
    if let Some(reset) = state.store.latest_reset_operation(id)? {
        if reset.status == "active" {
            return Err(AppError::BadRequest(format!(
                "cannot {action} while reset recovery is required"
            )));
        }
    }
    Ok(())
}

fn resolve_commit(repository: &str, revision: &str) -> Result<String> {
    command_output(
        Path::new(repository),
        "git",
        &["rev-parse", "--verify", &format!("{revision}^{{commit}}")],
    )
    .map_err(|error| AppError::BadRequest(format!("resolve reset target {revision}: {error}")))
}

fn workspace_delivery_target(state: &AppState, workspace: &Workspace) -> Result<(String, String)> {
    if workspace.kind == "fork" {
        let parent_id = workspace.parent_workspace_id.as_deref().ok_or_else(|| {
            AppError::Internal(anyhow::anyhow!("Fork is missing its parent Workspace"))
        })?;
        let parent = state.store.workspace(parent_id)?;
        if parent.status != "active" {
            return Err(AppError::BadRequest(
                "the parent Workspace must be active to receive this Fork".into(),
            ));
        }
        return Ok((parent.checkout_path, parent.branch));
    }
    let directory = state.store.directory(&workspace.project_directory_id)?;
    Ok((directory.path, workspace.target_branch.clone()))
}

#[derive(Clone, Deserialize)]

struct FinishWorkspace {
    code_action: String,
    todo_action: String,
    #[serde(default)]
    push_after_merge: bool,
    keep_session_history: bool,
    delete_worktree: bool,
    delete_branch: bool,
    commit_message: Option<String>,
    preflight_id: Option<String>,
}

async fn finish_workspace(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<FinishWorkspace>,
) -> Result<Json<Workspace>> {
    finish_workspace_impl(&state, &id, &input, None)
        .await
        .map(Json)
}

async fn finish_workspace_impl(
    state: &AppState,
    id: &str,
    input: &FinishWorkspace,
    fail_after_phase: Option<&str>,
) -> Result<Workspace> {
    let result = finish_workspace_steps(state, id, input, fail_after_phase).await;
    if let Err(error) = &result {
        if state.store.delivery_operation(id).ok().flatten().is_some() {
            let _ = state.store.set_delivery_error(id, &error.to_string());
        }
    }
    result
}

async fn finish_workspace_steps(
    state: &AppState,
    id: &str,
    input: &FinishWorkspace,
    fail_after_phase: Option<&str>,
) -> Result<Workspace> {
    validate_delivery_input(input)?;

    let workspace = state.store.workspace(id)?;
    if workspace.kind == "base" {
        return Err(AppError::BadRequest(
            "Project Sessions do not have a delivery lifecycle".into(),
        ));
    }
    if workspace.kind == "workspace"
        && state
            .store
            .forks(id)?
            .iter()
            .any(|fork| fork.status == "active")
    {
        return Err(AppError::BadRequest(
            "finish active Forks before finishing their parent Workspace".into(),
        ));
    }
    if workspace.kind == "fork" && input.code_action == "remote_merged" {
        return Err(AppError::BadRequest(
            "a Fork must be merged into its parent Workspace locally".into(),
        ));
    }
    if workspace.kind == "fork" && input.push_after_merge {
        return Err(AppError::BadRequest(
            "a Fork cannot push after merge; its parent Workspace owns remote synchronization"
                .into(),
        ));
    }
    if input.todo_action == "carry" && workspace.kind != "fork" {
        return Err(AppError::BadRequest(
            "only a Fork can carry Todos into a parent Workspace".into(),
        ));
    }
    let existing_operation = state.store.delivery_operation(id)?;
    if workspace.status == "archived" {
        let operation = existing_operation
            .ok_or_else(|| AppError::BadRequest("Workspace is already archived".into()))?;
        ensure_delivery_matches(&operation, input)?;
        state
            .store
            .advance_delivery(id, "archived", None, None, None)?;
        return state.store.workspace(id);
    }
    if let Some(operation) = state.store.latest_rebase_operation(id)? {
        let operation = if rebase_operation_blocks(&operation) {
            rebase_status_impl(state, id)?.ok_or_else(|| {
                AppError::Internal(anyhow::anyhow!("active rebase operation disappeared"))
            })?
        } else {
            operation
        };
        if rebase_operation_blocks(&operation) {
            return Err(AppError::BadRequest(format!(
                "cannot finish while Workspace rebase is {}",
                operation.status
            )));
        }
    }
    if reset_status_impl(state, id)?.is_some_and(|operation| operation.status == "active") {
        return Err(AppError::BadRequest(
            "cannot finish while reset recovery is required".into(),
        ));
    }
    let project = state.store.project(&workspace.project_id)?;
    let directory = state.store.directory(&workspace.project_directory_id)?;
    let (target_path, target_branch) = workspace_delivery_target(state, &workspace)?;

    let source_is_managed = true;
    let mut operation = match existing_operation {
        Some(operation) => {
            ensure_delivery_matches(&operation, input)?;
            operation
        }
        None => {
            if workspace.status != "active" {
                return Err(AppError::BadRequest("Workspace is already archived".into()));
            }
            if source_is_managed {
                validate_preflight_snapshot(state, &workspace, &target_path, &target_branch, input)
                    .await?;
            }
            if input.code_action == "local_merge" {
                if !source_is_managed || workspace.branch.is_empty() {
                    return Err(AppError::BadRequest(
                        "Workspace has no managed branch to merge".into(),
                    ));
                }
                ensure_clean_workspace(&target_path, "merge target")?;
                ensure_target_branch(&target_path, &target_branch)?;
            }
            let before_head = if input.code_action == "remote_merged" {
                let remote = project.preferred_remote.as_deref().ok_or_else(|| {
                    AppError::BadRequest("Project has no preferred remote target".into())
                })?;
                fetch_remote_branch_async(&directory.path, remote, &target_branch).await?;
                command_output(
                    Path::new(&directory.path),
                    "git",
                    &["rev-parse", "FETCH_HEAD"],
                )
                .map_err(AppError::BadRequest)?
            } else {
                git_head(&target_path)?
            };
            let source_head = if source_is_managed {
                git_head(&workspace.checkout_path)?
            } else {
                String::new()
            };
            let timestamp = now();
            let operation = DeliveryOperation {
                workspace_id: id.to_owned(),
                workspace_location_id: state.store.default_workspace_location(id)?.id,
                phase: "preflight_passed".into(),
                code_action: input.code_action.clone(),
                todo_action: input.todo_action.clone(),
                push_after_merge: input.push_after_merge,
                keep_session_history: input.keep_session_history,
                delete_worktree: input.delete_worktree,
                delete_branch: input.delete_branch,
                commit_message: trimmed(input.commit_message.clone()).unwrap_or_default(),
                before_head: before_head.clone(),
                source_head,
                target_head: before_head,
                integrated_commit: None,
                error: String::new(),
                started_at: timestamp.clone(),
                updated_at: timestamp,
            };
            state.store.create_delivery_operation(&operation)?;
            operation
        }
    };

    if !delivery_phase_at_least(&operation.phase, "code_integrated")? {
        let mut source_head = operation.source_head.clone();
        let mut target_head = operation.target_head.clone();
        let mut integrated_commit = None;
        if input.code_action == "local_merge" {
            ensure_clean_workspace(&target_path, "merge target")?;
            ensure_target_branch(&target_path, &target_branch)?;
            let current_target_head = git_head(&target_path)?;
            if current_target_head != operation.before_head {
                return Err(AppError::BadRequest(format!(
                    "merge target moved after delivery preflight: expected {}, found {}",
                    operation.before_head, current_target_head
                )));
            }
            let commit_workspace = workspace.clone();
            let commit_message = input.commit_message.clone();
            blocking_git_operation(move || {
                commit_source_if_needed(&commit_workspace, commit_message.as_deref())
            })
            .await?;
            source_head = git_head(&workspace.checkout_path)?;
            let merge_target = target_path.clone();
            let merge_branch = workspace.branch.clone();
            if let Err(error) = blocking_git_operation(move || {
                if let Err(error) = command_output(
                    Path::new(&merge_target),
                    "git",
                    &["merge", "--no-edit", &merge_branch],
                ) {
                    let _ = command_output(Path::new(&merge_target), "git", &["merge", "--abort"]);
                    return Err(AppError::BadRequest(error));
                }
                Ok(())
            })
            .await
            {
                state.store.set_delivery_status(id, "conflicted")?;
                return Err(AppError::BadRequest(format!(
                    "merge failed; both worktrees and branches were preserved: {error}"
                )));
            }
            target_head = git_head(&target_path)?;
            integrated_commit = Some(target_head.clone());
        } else if input.code_action == "keep" && input.delete_worktree {
            let commit_workspace = workspace.clone();
            let commit_message = input.commit_message.clone();
            blocking_git_operation(move || {
                commit_source_if_needed(&commit_workspace, commit_message.as_deref())
            })
            .await?;
            source_head = git_head(&workspace.checkout_path)?;
        }
        state.store.advance_delivery(
            id,
            "code_integrated",
            Some(&source_head),
            Some(&target_head),
            integrated_commit.as_deref(),
        )?;
        operation.phase = "code_integrated".into();
        operation.source_head = source_head;
        operation.target_head = target_head;
        operation.integrated_commit = integrated_commit;
    }
    fail_delivery_after(fail_after_phase, "code_integrated")?;

    if !delivery_phase_at_least(&operation.phase, "target_pushed")? {
        if input.code_action == "local_merge" && input.push_after_merge {
            let remote = workspace
                .remote_name
                .as_deref()
                .or(project.preferred_remote.as_deref())
                .ok_or_else(|| {
                    AppError::BadRequest("no remote is configured for target push".into())
                })?;
            let refspec = format!("{target_branch}:{target_branch}");
            git::output_async(Path::new(&target_path), &["push", remote, &refspec])
                .await
                .map_err(|error| {
                    AppError::BadRequest(format!(
                        "Workspace was merged locally but target push failed: {error}"
                    ))
                })?;
        }
        state
            .store
            .advance_delivery(id, "target_pushed", None, None, None)?;
        operation.phase = "target_pushed".into();
    }
    fail_delivery_after(fail_after_phase, "target_pushed")?;

    if !delivery_phase_at_least(&operation.phase, "records_carried")? {
        if input.todo_action == "carry" {
            let parent_id = workspace.parent_workspace_id.as_deref().ok_or_else(|| {
                AppError::BadRequest("only a Fork can carry Todos into a parent Workspace".into())
            })?;
            state.store.carry_todos(id, parent_id)?;
        } else if input.todo_action == "discard" {
            state.store.delete_todos(id)?;
        }
        state
            .store
            .advance_delivery(id, "records_carried", None, None, None)?;
        operation.phase = "records_carried".into();
    }
    fail_delivery_after(fail_after_phase, "records_carried")?;

    if !delivery_phase_at_least(&operation.phase, "sessions_finalized")? {
        for mut session in state.store.sessions(id)? {
            capture_codex_session_id(&state.store, &mut session)?;
            if input.keep_session_history && session.kind == "codex" {
                let _ = state.terminals.stop_existing(&session.amux_workspace_name, &session.amux_process_name).await;
            } else {
                let _ = state.terminals.remove_existing(&session.amux_workspace_name, &session.amux_process_name).await;
            }
        }
        let resume_cwd = if input.delete_worktree {
            target_path.as_str()
        } else {
            workspace.checkout_path.as_str()
        };
        state
            .store
            .finalize_sessions(id, resume_cwd, input.keep_session_history)?;
        state
            .store
            .advance_delivery(id, "sessions_finalized", None, None, None)?;
        operation.phase = "sessions_finalized".into();
    }
    fail_delivery_after(fail_after_phase, "sessions_finalized")?;

    if !delivery_phase_at_least(&operation.phase, "resources_cleaned")? {
        if input.delete_worktree && source_is_managed {
            let repository = directory.path.clone();
            let checkout_path = workspace.checkout_path.clone();
            blocking_git_operation(move || remove_worktree_if_present(&repository, &checkout_path))
                .await?;
        }
        if input.delete_branch && !workspace.branch.is_empty() {
            let merged_target = if input.code_action == "remote_merged" {
                let remote = project.preferred_remote.as_deref().ok_or_else(|| {
                    AppError::BadRequest("Project has no preferred remote target".into())
                })?;
                fetch_remote_branch_async(&directory.path, remote, &target_branch).await?;
                "FETCH_HEAD"
            } else {
                target_branch.as_str()
            };
            let repository = directory.path.clone();
            let branch = workspace.branch.clone();
            let merged_target = merged_target.to_owned();
            let source_head = operation.source_head.clone();
            let require_merged =
                input.code_action == "local_merge" || input.code_action == "remote_merged";
            blocking_git_operation(move || {
                delete_delivered_branch_if_present(
                    &repository,
                    &branch,
                    &merged_target,
                    &source_head,
                    require_merged,
                )
            })
            .await?;
        }
        state
            .store
            .advance_delivery(id, "resources_cleaned", None, None, None)?;
        operation.phase = "resources_cleaned".into();
    }
    fail_delivery_after(fail_after_phase, "resources_cleaned")?;

    let delivery_status = match input.code_action.as_str() {
        "local_merge" => "locally_merged",
        "remote_merged" => "remotely_merged",
        "discard" => "discarded",
        _ => "preserved",
    };
    let timestamp = now();
    state.store.finish_workspace(
        id,
        delivery_status,
        &input.code_action,
        operation.integrated_commit.as_deref(),
        &timestamp,
    )?;
    state
        .store
        .advance_delivery(id, "archived", None, None, None)?;
    state.store.workspace(id)
}


fn validate_delivery_input(input: &FinishWorkspace) -> Result<()> {
    if !["local_merge", "remote_merged", "keep", "discard"].contains(&input.code_action.as_str()) {
        return Err(AppError::BadRequest("invalid code action".into()));
    }
    if !["carry", "keep", "discard"].contains(&input.todo_action.as_str()) {
        return Err(AppError::BadRequest("invalid Todo action".into()));
    }
    if input.todo_action == "carry" && input.code_action != "local_merge" {
        return Err(AppError::BadRequest(
            "Todos can be carried only when a Fork is merged into its parent Workspace".into(),
        ));
    }
    if input.code_action == "keep" && input.delete_branch {
        return Err(AppError::BadRequest(
            "a preserved branch cannot be deleted".into(),
        ));
    }
    if input.push_after_merge && input.code_action != "local_merge" {
        return Err(AppError::BadRequest(
            "push_after_merge is valid only for local_merge".into(),
        ));
    }
    if input.delete_branch && !input.delete_worktree {
        return Err(AppError::BadRequest(
            "remove the managed worktree before deleting its checked-out branch".into(),
        ));
    }
    if input.code_action == "discard" && (!input.delete_worktree || !input.delete_branch) {
        return Err(AppError::BadRequest(
            "discarding code requires removing both its managed worktree and branch".into(),
        ));
    }
    Ok(())
}

fn ensure_delivery_matches(operation: &DeliveryOperation, input: &FinishWorkspace) -> Result<()> {
    let commit_message = trimmed(input.commit_message.clone()).unwrap_or_default();
    if operation.code_action != input.code_action
        || operation.todo_action != input.todo_action
        || operation.push_after_merge != input.push_after_merge
        || operation.keep_session_history != input.keep_session_history
        || operation.delete_worktree != input.delete_worktree
        || operation.delete_branch != input.delete_branch
        || operation.commit_message != commit_message
    {
        return Err(AppError::BadRequest(
            "delivery is already in progress with different options".into(),
        ));
    }
    Ok(())
}

fn delivery_phase_at_least(current: &str, expected: &str) -> Result<bool> {
    const PHASES: [&str; 7] = [
        "preflight_passed",
        "code_integrated",
        "target_pushed",
        "records_carried",
        "sessions_finalized",
        "resources_cleaned",
        "archived",
    ];
    let rank = |phase: &str| {
        PHASES
            .iter()
            .position(|candidate| *candidate == phase)
            .ok_or_else(|| AppError::Internal(anyhow::anyhow!("unknown delivery phase {phase}")))
    };
    Ok(rank(current)? >= rank(expected)?)
}

fn fail_delivery_after(actual: Option<&str>, phase: &str) -> Result<()> {
    if actual == Some(phase) {
        return Err(AppError::BadRequest(format!(
            "injected delivery failure after {phase}"
        )));
    }
    Ok(())
}

fn ensure_target_branch(path: &str, target_branch: &str) -> Result<()> {
    ensure_checked_out_branch(path, target_branch, "merge target")
}

fn ensure_checked_out_branch(path: &str, expected_branch: &str, label: &str) -> Result<()> {
    let checked_out = command_output(Path::new(path), "git", &["branch", "--show-current"])
        .map_err(AppError::BadRequest)?;
    if checked_out != expected_branch {
        return Err(AppError::BadRequest(format!(
            "{label} must be on branch {expected_branch}; currently on {checked_out}"
        )));
    }
    Ok(())
}

fn git_head(path: &str) -> Result<String> {
    command_output(Path::new(path), "git", &["rev-parse", "HEAD"]).map_err(AppError::BadRequest)
}

fn remove_worktree_if_present(repository: &str, checkout_path: &str) -> Result<()> {
    let expected = normalized_path(checkout_path);
    let registered = git_worktrees(repository)?
        .iter()
        .any(|worktree| normalized_path(&worktree.path) == expected);
    if registered {
        command_output(
            Path::new(repository),
            "git",
            &["worktree", "remove", "--force", checkout_path],
        )
        .map_err(|error| {
            AppError::BadRequest(format!(
                "code was delivered but the worktree could not be removed: {error}"
            ))
        })?;
    } else if Path::new(checkout_path).exists() {
        return Err(AppError::BadRequest(format!(
            "managed worktree is no longer registered but its directory remains: {checkout_path}"
        )));
    }
    Ok(())
}

fn delete_delivered_branch_if_present(
    repository: &str,
    branch: &str,
    target_branch: &str,
    source_head: &str,
    require_merged: bool,
) -> Result<()> {
    if !git_ref_names(repository, "refs/heads")?
        .iter()
        .any(|candidate| candidate == branch)
    {
        return Ok(());
    }
    if require_merged {
        command_output(
            Path::new(repository),
            "git",
            &["merge-base", "--is-ancestor", source_head, target_branch],
        )
        .map_err(|_| {
            AppError::BadRequest(
                "branch cleanup was stopped because the source commit is not reachable from the merge target"
                    .into(),
            )
        })?;
    }
    command_output(Path::new(repository), "git", &["branch", "-D", branch]).map_err(|error| {
        AppError::BadRequest(format!(
            "worktree was removed but branch cleanup failed: {error}"
        ))
    })?;
    Ok(())
}

fn ensure_clean_workspace(path: &str, label: &str) -> Result<()> {
    let status = command_output(Path::new(path), "git", &["status", "--porcelain"])
        .map_err(AppError::BadRequest)?;
    if !status.is_empty() {
        return Err(AppError::BadRequest(format!(
            "{label} has uncommitted changes"
        )));
    }
    Ok(())
}

fn commit_source_if_needed(workspace: &Workspace, message: Option<&str>) -> Result<()> {
    let status = command_output(
        Path::new(&workspace.checkout_path),
        "git",
        &["status", "--porcelain"],
    )
    .map_err(AppError::BadRequest)?;
    if status.is_empty() {
        return Ok(());
    }
    let message = message.map(str::trim).filter(|value| !value.is_empty()).ok_or_else(|| {
        AppError::BadRequest(
            "the workspace has uncommitted changes; provide a final commit message or choose Discard"
                .into(),
        )
    })?;
    command_output(Path::new(&workspace.checkout_path), "git", &["add", "-A"])
        .map_err(AppError::BadRequest)?;
    command_output(
        Path::new(&workspace.checkout_path),
        "git",
        &["commit", "-m", message],
    )
    .map_err(AppError::BadRequest)?;
    Ok(())
}
