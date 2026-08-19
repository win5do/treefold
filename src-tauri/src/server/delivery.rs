use super::*;

pub(super) async fn get_workspace_location_rebase(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Option<RebaseOperation>>> {
    state.store.workspace_location(&id)?;
    let operation = state
        .store
        .latest_parent_operation(&id, "update")?
        .map(|operation| reconcile_parent_operation(&state, &operation))
        .transpose()?
        .map(parent_operation_as_rebase);
    Ok(Json(operation))
}

pub(super) async fn update_workspace_location_rebase(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<RebaseInput>,
) -> Result<Json<RebaseOperation>> {
    let common = state
        .store
        .repository(&state.store.workspace_location(&id)?.project_location_id)?
        .git_common_dir;
    blocking_git_operation_for(common, move || {
        update_workspace_location_rebase_impl(state, id, input)
    })
    .await
}

pub(super) fn update_workspace_location_rebase_impl(
    state: AppState,
    id: String,
    input: RebaseInput,
) -> Result<Json<RebaseOperation>> {
    let operation = match input.action.as_str() {
        "start" => parent_operation_as_rebase(start_parent_operation_impl(
            &state,
            &id,
            "update",
            "rebase",
            "standalone",
            None,
        )?),
        "continue" | "abort" => {
            let current = state
                .store
                .latest_parent_operation(&id, "update")?
                .ok_or_else(|| {
                    AppError::BadRequest("no rebase operation exists for this location".into())
                })?;
            let operation = if input.action == "continue" {
                reconcile_parent_operation(&state, &current)?
            } else {
                abort_parent_operation_impl(&state, &current)?
            };
            parent_operation_as_rebase(operation)
        }
        _ => {
            return Err(AppError::BadRequest(
                "rebase action must be start, continue, or abort".into(),
            ));
        }
    };
    Ok(Json(operation))
}

pub(super) fn parent_operation_as_rebase(operation: ParentOperation) -> RebaseOperation {
    RebaseOperation {
        id: operation.id,
        workspace_location_id: operation.workspace_repository_id,
        workspace_id: operation.workspace_id,
        status: operation.status,
        phase: operation.phase,
        before_head: operation.before_head,
        target_head: operation.parent_head,
        rebased_head: operation.result_head,
        recovery_ref: operation.recovery_ref,
        error: operation.error,
        started_at: operation.started_at,
        updated_at: operation.updated_at,
        completed_at: operation.completed_at,
    }
}


pub(super) async fn finish_workspace_location(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<FinishWorkspace>,
) -> Result<Json<FinishProgress>> {
    let location = state.store.workspace_location(&id)?;
    let workspace = state.store.workspace(&location.workspace_id)?;
    let project_id = workspace.project_id;
    let common = state
        .store
        .repository(&location.project_location_id)?
        .git_common_dir;
    let result = blocking_git_operation_for(common, move || {
        finish_workspace_location_impl(state, id, input)
    })
    .await;
    project_worktrees_cache().invalidate(&project_id).await;
    result
}

pub(super) fn finish_workspace_location_impl(
    state: AppState,
    id: String,
    input: FinishWorkspace,
) -> Result<Json<FinishProgress>> {
    validate_delivery_input(&input)?;
    let location = state.store.workspace_location(&id)?;
    let workspace = state.store.workspace(&location.workspace_id)?;
    if location.access_mode != "read_write" {
        return Err(AppError::BadRequest(
            "read-only locations do not require Finish".into(),
        ));
    }
    if !matches!(
        location.delivery_status.as_str(),
        "active" | "published" | "failed" | "conflicted"
    ) {
        return Ok(Json(FinishProgress {
            status: "finished".into(),
            location,
            operation: None,
        }));
    }
    if workspace.kind == "fork" && input.code_action == "push_branch" {
        return Err(AppError::BadRequest(
            "a Fork has no remote delivery target; merge it into its parent Workspace or preserve it"
                .into(),
        ));
    }
    let preflight_id = input.preflight_id.as_deref().ok_or_else(|| {
        AppError::BadRequest(
            "run delivery preflight before finishing this Workspace location".into(),
        )
    })?;
    let preflight = state.store.delivery_preflight(preflight_id)?;
    if preflight.workspace_location_id != location.id || preflight.code_action != input.code_action
    {
        return Err(AppError::BadRequest(
            "preflight does not match this Workspace location".into(),
        ));
    }
    if !preflight.blockers.is_empty() {
        return Err(AppError::BadRequest(format!(
            "delivery preflight is blocked: {}",
            preflight.blockers.join("; ")
        )));
    }
    let source_path = workspace_location_git_path(&location)?.to_owned();
    let branch = location
        .branch
        .as_deref()
        .ok_or_else(|| AppError::BadRequest("Workspace location has no branch".into()))?
        .to_owned();
    ensure_checked_out_branch(&source_path, &branch, "Workspace location")?;
    let source_status = command_output(Path::new(&source_path), "git", &["status", "--porcelain"])
        .map_err(AppError::BadRequest)?;
    let source_head = git_head(&source_path)?;
    if source_head != preflight.source_head || source_status != preflight.source_status {
        return Err(AppError::BadRequest(
            "delivery preflight is stale; source Git state changed".into(),
        ));
    }
    if !source_status.is_empty() {
        return Err(AppError::BadRequest(
            "Workspace has uncommitted changes; commit or discard them in Shell before finishing"
                .into(),
        ));
    }
    if input.code_action == "local_merge" {
        let previous = state
            .store
            .latest_parent_operation(&location.id, "integrate")?;
        if !previous
            .as_ref()
            .is_some_and(|operation| operation.status == "completed")
        {
            let (target_path, target_branch) =
                workspace_location_delivery_target(&state, &workspace, &location)?;
            let target_head = command_output(
                Path::new(&target_path),
                "git",
                &["rev-parse", &target_branch],
            )
            .map_err(AppError::BadRequest)?;
            if target_head != preflight.target_head {
                return Err(AppError::BadRequest(
                    "delivery preflight is stale; merge target moved".into(),
                ));
            }
        }
    }
    if input.code_action == "push_branch" {
        let remote = location.remote_name.as_deref().ok_or_else(|| {
            AppError::BadRequest("Workspace location has no remote configured".into())
        })?;
        let remote_branch = location.remote_branch.as_deref().ok_or_else(|| {
            AppError::BadRequest("Workspace location has no remote branch configured".into())
        })?;
        let remote_head =
            remote_branch_head(&source_path, remote, remote_branch)?.unwrap_or_default();
        if remote_head != preflight.target_head {
            return Err(AppError::BadRequest(
                "delivery preflight is stale; remote feature branch moved".into(),
            ));
        }
    }
    let mut linked_operation = None;
    let (status, outcome, integrated) = match input.code_action.as_str() {
        "local_merge" => {
            let previous = state
                .store
                .latest_parent_operation(&location.id, "integrate")?;
            let operation = start_parent_operation_impl(
                &state,
                &location.id,
                "integrate",
                "merge",
                "finish",
                Some(&location.id),
            )?;
            if matches!(
                operation.status.as_str(),
                "conflicted" | "resolving" | "recovery_required" | "active"
            ) {
                state
                    .store
                    .set_delivery_status(&location.id, "conflicted")?;
                return Ok(Json(FinishProgress {
                    status: "paused".into(),
                    location: state.store.workspace_location(&location.id)?,
                    operation: Some(operation),
                }));
            }
            if operation.status != "completed" {
                return Err(AppError::BadRequest(format!(
                    "integration ended with status {}",
                    operation.status
                )));
            }
            let resumed = previous.as_ref().is_some_and(|previous| {
                previous.id == operation.id && previous.status == "completed"
            });
            if resumed && !input.resume_finish {
                return Ok(Json(FinishProgress {
                    status: "awaiting_resume".into(),
                    location: state.store.workspace_location(&location.id)?,
                    operation: Some(operation),
                }));
            }
            let head = operation.result_head.clone().ok_or_else(|| {
                AppError::BadRequest("completed integration has no result HEAD".into())
            })?;
            linked_operation = Some(operation);
            ("delivered", "local_merge", Some(head))
        }
        "push_branch" => {
            let remote = location.remote_name.as_deref().ok_or_else(|| {
                AppError::BadRequest("Workspace location has no remote configured".into())
            })?;
            let remote_branch = location.remote_branch.as_deref().ok_or_else(|| {
                AppError::BadRequest("Workspace location has no remote branch configured".into())
            })?;
            command_output(
                Path::new(&source_path),
                "git",
                &["push", remote, &format!("{branch}:{remote_branch}")],
            )
            .map_err(AppError::BadRequest)?;
            fetch_remote_branch(&source_path, remote, remote_branch)?;
            if !git_is_ancestor(&source_path, &source_head, "FETCH_HEAD")? {
                return Err(AppError::BadRequest(
                    "remote feature branch does not contain the Workspace HEAD after push".into(),
                ));
            }
            ("pushed", "push_branch", Some(source_head.clone()))
        }
        "keep" => ("kept", "keep", Some(source_head.clone())),
        _ => unreachable!(),
    };
    if let Some(operation) = linked_operation.as_ref() {
        consume_parent_operation(&state, operation)?;
    }
    if input.delete_worktree {
        let project_location = state
            .store
            .repository_as_directory(&location.project_location_id)?;
        remove_worktree_if_present(&project_location.path, &source_path, false)?;
        if input.delete_branch {
            let (target, require_merged) = match input.code_action.as_str() {
                "local_merge" => {
                    let (_, target_branch) =
                        workspace_location_delivery_target(&state, &workspace, &location)?;
                    (target_branch, true)
                }
                "push_branch" => ("FETCH_HEAD".to_owned(), true),
                _ => ("HEAD".to_owned(), false),
            };
            delete_delivered_branch_if_present(
                &project_location.path,
                &branch,
                &target,
                &source_head,
                require_merged,
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
    if workspace.kind == "fork" && outcome == "local_merge" {
        let all_delivered = state
            .store
            .workspace_locations(&workspace.id)?
            .iter()
            .filter(|item| item.access_mode == "read_write")
            .all(|item| item.delivery_status == "delivered");
        if all_delivered && let Some(todo) = state.store.todo_for_fork(&workspace.id)? {
            state.store.update_todo(&todo.id, "done")?;
        }
    }
    Ok(Json(FinishProgress {
        status: "finished".into(),
        location: state.store.workspace_location(&location.id)?,
        operation: linked_operation,
    }))
}

pub(super) fn workspace_location_delivery_target(
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
    let project_location = state
        .store
        .repository_as_directory(&location.project_location_id)?;
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
pub(super) struct RebaseInput {
    action: String,
}

pub(super) async fn get_rebase_status(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Option<RebaseOperation>>> {
    Ok(Json(rebase_status_impl(&state, &id)?))
}

pub(super) async fn update_rebase(
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

pub(super) fn start_rebase(state: &AppState, id: &str) -> Result<RebaseOperation> {
    let (workspace, directory) = rebase_context(state, id)?;
    if state.store.delivery_operation(id)?.is_some() {
        return Err(AppError::BadRequest(
            "cannot rebase while delivery is in progress".into(),
        ));
    }
    if let Some(operation) = state.store.latest_rebase_operation(id)?
        && rebase_operation_blocks(&operation)
    {
        return rebase_status_impl(state, id)?.ok_or_else(|| {
            AppError::Internal(anyhow::anyhow!("active rebase operation disappeared"))
        });
    }

    ensure_clean_workspace(&workspace.checkout_path, "Workspace")?;
    ensure_checked_out_branch(&workspace.checkout_path, &workspace.branch, "Workspace")?;
    let before_head = git_head(&workspace.checkout_path)?;
    let target_head = command_output(
        Path::new(&workspace.checkout_path),
        "git",
        &["rev-parse", "--verify", &workspace.target_branch],
    )
    .map_err(AppError::BadRequest)?;
    let operation_id = id_for_operation();
    let recovery_ref = format!("refs/treefold/recovery/rebase-{operation_id}");
    command_output(
        Path::new(&workspace.checkout_path),
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
        let _ = delete_recovery_ref(&workspace.checkout_path, &operation.recovery_ref);
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

pub(super) fn continue_rebase(state: &AppState, id: &str) -> Result<RebaseOperation> {
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

pub(super) fn abort_rebase(state: &AppState, id: &str) -> Result<RebaseOperation> {
    let operation = state.store.latest_rebase_operation(id)?.ok_or_else(|| {
        AppError::BadRequest("no rebase operation exists for this Workspace".into())
    })?;
    if rebase_operation_is_final(&operation) {
        return Ok(operation);
    }
    let (workspace, _directory) = rebase_context(state, id)?;
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
    delete_recovery_ref(&workspace.checkout_path, &operation.recovery_ref)?;
    state
        .store
        .update_rebase_operation(&operation.id, "aborted", "aborted", None, "", true)?;
    latest_rebase_required(state, id)
}

pub(super) fn rebase_status_impl(state: &AppState, id: &str) -> Result<Option<RebaseOperation>> {
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
            delete_recovery_ref(&workspace.checkout_path, &operation.recovery_ref)?;
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

pub(super) fn execute_rebase(
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

pub(super) fn finalize_rebase(
    state: &AppState,
    workspace: &Workspace,
    _directory: &Directory,
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
    delete_recovery_ref(&workspace.checkout_path, &operation.recovery_ref)?;
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

pub(super) fn rebase_context(state: &AppState, id: &str) -> Result<(Workspace, Directory)> {
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

pub(super) fn latest_rebase_required(state: &AppState, id: &str) -> Result<RebaseOperation> {
    state
        .store
        .latest_rebase_operation(id)?
        .ok_or_else(|| AppError::Internal(anyhow::anyhow!("rebase operation disappeared")))
}

pub(super) fn rebase_operation_is_final(operation: &RebaseOperation) -> bool {
    matches!(operation.status.as_str(), "completed" | "aborted")
}

pub(super) fn rebase_operation_blocks(operation: &RebaseOperation) -> bool {
    !rebase_operation_is_final(operation)
}

pub(super) fn id_for_operation() -> String {
    Uuid::new_v4().simple().to_string()
}

pub(super) fn rebase_in_progress(workspace: &str) -> Result<bool> {
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

pub(super) fn has_unmerged_paths(workspace: &str) -> Result<bool> {
    let paths = command_output(
        Path::new(workspace),
        "git",
        &["diff", "--name-only", "--diff-filter=U"],
    )
    .map_err(AppError::BadRequest)?;
    Ok(!paths.is_empty())
}

pub(super) fn git_is_ancestor(workspace: &str, ancestor: &str, descendant: &str) -> Result<bool> {
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

pub(super) async fn git_is_ancestor_async(
    workspace: &str,
    ancestor: &str,
    descendant: &str,
) -> Result<bool> {
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

pub(super) fn delete_recovery_ref(repository: &str, recovery_ref: &str) -> Result<()> {
    command_output(
        Path::new(repository),
        "git",
        &["update-ref", "-d", recovery_ref],
    )
    .map_err(|error| AppError::BadRequest(format!("delete recovery ref: {error}")))?;
    Ok(())
}

pub(super) fn git_rebase_output(dir: &Path, args: &[&str]) -> std::result::Result<String, String> {
    let mut command_args = Vec::with_capacity(args.len() + 1);
    command_args.push("rebase");
    command_args.extend_from_slice(args);
    git::output_with_env(
        dir,
        &command_args,
        &[("GIT_EDITOR", "true"), ("GIT_SEQUENCE_EDITOR", "true")],
    )
}


pub(super) fn ensure_no_git_operation_in_progress(
    state: &AppState,
    id: &str,
    action: &str,
) -> Result<()> {
    if state.store.delivery_operation(id)?.is_some() {
        return Err(AppError::BadRequest(format!(
            "cannot {action} while delivery is in progress"
        )));
    }
    if let Some(rebase) = state.store.latest_rebase_operation(id)?
        && rebase_operation_blocks(&rebase)
    {
        return Err(AppError::BadRequest(format!(
            "cannot {action} while rebase is {}",
            rebase.status
        )));
    }
    Ok(())
}

pub(super) fn workspace_delivery_target(
    state: &AppState,
    workspace: &Workspace,
) -> Result<(String, String)> {
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
    let repository_root = repository_root_for_directory(state, &workspace.project_directory_id)?;
    Ok((repository_root, workspace.target_branch.clone()))
}

#[derive(Clone, Deserialize)]

pub(super) struct FinishWorkspace {
    pub(super) code_action: String,
    #[serde(default)]
    pub(super) todo_action: String,
    #[serde(default)]
    pub(super) push_after_merge: bool,
    pub(super) keep_session_history: bool,
    pub(super) delete_worktree: bool,
    pub(super) delete_branch: bool,
    pub(super) commit_message: Option<String>,
    pub(super) preflight_id: Option<String>,
    #[serde(default)]
    pub(super) resume_finish: bool,
}

pub(super) async fn finish_workspace(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<FinishWorkspace>,
) -> Result<Json<Workspace>> {
    finish_workspace_impl(&state, &id, &input, None)
        .await
        .map(Json)
}

pub(super) async fn finish_workspace_impl(
    state: &AppState,
    id: &str,
    input: &FinishWorkspace,
    fail_after_phase: Option<&str>,
) -> Result<Workspace> {
    let result = finish_workspace_steps(state, id, input, fail_after_phase).await;
    if let Err(error) = &result
        && state.store.delivery_operation(id).ok().flatten().is_some()
    {
        let _ = state.store.set_delivery_error(id, &error.to_string());
    }
    result
}

pub(super) async fn finish_workspace_steps(
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
    if workspace.kind == "fork" && input.code_action == "push_branch" {
        return Err(AppError::BadRequest(
            "a Fork must be merged into its parent Workspace locally or preserved".into(),
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
    let project = state.store.project(&workspace.project_id)?;
    let repository_root = repository_root_for_directory(state, &workspace.project_directory_id)?;
    let (target_path, target_branch) = workspace_delivery_target(state, &workspace)?;

    let source_is_managed = true;
    ensure_clean_workspace(&workspace.checkout_path, "Workspace")?;
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
            let before_head = git_head(&target_path)?;
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
                commit_message: String::new(),
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
        } else if input.code_action == "push_branch" {
            let remote = workspace
                .remote_name
                .as_deref()
                .ok_or_else(|| AppError::BadRequest("Workspace has no remote configured".into()))?;
            let remote_branch = workspace.remote_branch.as_deref().ok_or_else(|| {
                AppError::BadRequest("Workspace has no remote branch configured".into())
            })?;
            let refspec = format!("{}:{remote_branch}", workspace.branch);
            git::output_async(
                Path::new(&workspace.checkout_path),
                &["push", remote, &refspec],
            )
            .await
            .map_err(AppError::BadRequest)?;
        }
        state
            .store
            .advance_delivery(id, "target_pushed", None, None, None)?;
        operation.phase = "target_pushed".into();
    }
    fail_delivery_after(fail_after_phase, "target_pushed")?;

    if !delivery_phase_at_least(&operation.phase, "records_carried")? {
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
                let _ = state
                    .terminals
                    .stop_existing(&session.amux_workspace_name, &session.amux_process_name)
                    .await;
            } else {
                let _ = state
                    .terminals
                    .remove_existing(&session.amux_workspace_name, &session.amux_process_name)
                    .await;
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
            let repository = repository_root.clone();
            let checkout_path = workspace.checkout_path.clone();
            blocking_git_operation(move || {
                remove_worktree_if_present(&repository, &checkout_path, false)
            })
            .await?;
        }
        if input.delete_branch && !workspace.branch.is_empty() {
            let merged_target = if input.code_action == "push_branch" {
                let remote = workspace.remote_name.as_deref().ok_or_else(|| {
                    AppError::BadRequest("Workspace has no remote configured".into())
                })?;
                let remote_branch = workspace.remote_branch.as_deref().ok_or_else(|| {
                    AppError::BadRequest("Workspace has no remote branch configured".into())
                })?;
                fetch_remote_branch_async(&repository_root, remote, remote_branch).await?;
                "FETCH_HEAD"
            } else {
                target_branch.as_str()
            };
            let repository = repository_root.clone();
            let branch = workspace.branch.clone();
            let merged_target = merged_target.to_owned();
            let source_head = operation.source_head.clone();
            let require_merged = input.code_action != "keep";
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
        "push_branch" => "pushed",
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
    if workspace.kind == "fork"
        && input.code_action == "local_merge"
        && let Some(todo) = state.store.todo_for_fork(id)?
    {
        state.store.update_todo(&todo.id, "done")?;
    }
    state
        .store
        .advance_delivery(id, "archived", None, None, None)?;
    state.store.workspace(id)
}

pub(super) fn validate_delivery_input(input: &FinishWorkspace) -> Result<()> {
    if !["local_merge", "push_branch", "keep"].contains(&input.code_action.as_str()) {
        return Err(AppError::BadRequest("invalid code action".into()));
    }
    if input.push_after_merge {
        return Err(AppError::BadRequest(
            "Finish does not push a merge target; choose push_branch to publish the Workspace feature branch"
                .into(),
        ));
    }
    if input.delete_branch && !input.delete_worktree {
        return Err(AppError::BadRequest(
            "remove the managed worktree before deleting its checked-out branch".into(),
        ));
    }
    Ok(())
}

pub(super) fn ensure_delivery_matches(
    operation: &DeliveryOperation,
    input: &FinishWorkspace,
) -> Result<()> {
    if operation.code_action != input.code_action
        || operation.todo_action != input.todo_action
        || operation.push_after_merge != input.push_after_merge
        || operation.keep_session_history != input.keep_session_history
        || operation.delete_worktree != input.delete_worktree
        || operation.delete_branch != input.delete_branch
    {
        return Err(AppError::BadRequest(
            "delivery is already in progress with different options".into(),
        ));
    }
    Ok(())
}

pub(super) fn delivery_phase_at_least(current: &str, expected: &str) -> Result<bool> {
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

pub(super) fn fail_delivery_after(actual: Option<&str>, phase: &str) -> Result<()> {
    if actual == Some(phase) {
        return Err(AppError::BadRequest(format!(
            "injected delivery failure after {phase}"
        )));
    }
    Ok(())
}

pub(super) fn ensure_target_branch(path: &str, target_branch: &str) -> Result<()> {
    let checked_out = command_output(Path::new(path), "git", &["branch", "--show-current"])
        .map_err(AppError::BadRequest)?;
    if checked_out == target_branch {
        return Ok(());
    }
    command_output(Path::new(path), "git", &["switch", target_branch]).map_err(|error| {
        AppError::BadRequest(format!(
            "switch merge target from {checked_out} to {target_branch}: {error}"
        ))
    })?;
    ensure_checked_out_branch(path, target_branch, "merge target")
}

pub(super) fn ensure_checked_out_branch(
    path: &str,
    expected_branch: &str,
    label: &str,
) -> Result<()> {
    let checked_out = command_output(Path::new(path), "git", &["branch", "--show-current"])
        .map_err(AppError::BadRequest)?;
    if checked_out != expected_branch {
        return Err(AppError::BadRequest(format!(
            "{label} must be on branch {expected_branch}; currently on {checked_out}"
        )));
    }
    Ok(())
}

pub(super) fn git_head(path: &str) -> Result<String> {
    command_output(Path::new(path), "git", &["rev-parse", "HEAD"]).map_err(AppError::BadRequest)
}

pub(super) fn remove_worktree_if_present(
    repository: &str,
    checkout_path: &str,
    discard_changes: bool,
) -> Result<()> {
    let expected = normalized_path(checkout_path);
    let registered = git_worktrees(repository)?
        .iter()
        .any(|worktree| normalized_path(&worktree.path) == expected);
    if registered {
        let mut args = vec!["worktree", "remove"];
        if discard_changes {
            args.push("--force");
        }
        args.push(checkout_path);
        command_output(Path::new(repository), "git", &args).map_err(|error| {
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

pub(super) fn delete_delivered_branch_if_present(
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

pub(super) fn ensure_clean_workspace(path: &str, label: &str) -> Result<()> {
    let status = command_output(Path::new(path), "git", &["status", "--porcelain"])
        .map_err(AppError::BadRequest)?;
    if !status.is_empty() {
        return Err(AppError::BadRequest(format!(
            "{label} has uncommitted changes"
        )));
    }
    Ok(())
}
