use super::*;

pub(super) async fn create_workspace_repository_preflight(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<CreateDeliveryPreflight>,
) -> Result<(StatusCode, Json<DeliveryPreflight>)> {
    blocking_git_operation(move || create_workspace_repository_preflight_impl(state, id, input))
        .await
}

pub(super) fn create_workspace_repository_preflight_impl(
    state: AppState,
    id: String,
    input: CreateDeliveryPreflight,
) -> Result<(StatusCode, Json<DeliveryPreflight>)> {
    if !["local_merge", "push_branch", "keep"].contains(&input.code_action.as_str()) {
        return Err(AppError::BadRequest("invalid code action".into()));
    }
    let location = state.store.workspace_repository(&id)?;
    let workspace = state.store.workspace(&location.workspace_id)?;
    if workspace.kind == "fork" && input.code_action == "push_branch" {
        return Err(AppError::BadRequest(
            "a Fork has no remote delivery target; merge it into its parent Workspace or preserve it"
                .into(),
        ));
    }
    let source_path = workspace_repository_git_path(&location)?;
    let source_branch = location
        .branch
        .as_deref()
        .ok_or_else(|| AppError::BadRequest("Workspace Repository has no branch".into()))?;
    ensure_checked_out_branch(source_path, source_branch, "Workspace Repository")?;
    let source_head = git_head(source_path)?;
    let source_status = command_output(Path::new(source_path), "git", &["status", "--porcelain"])
        .map_err(AppError::BadRequest)?;
    let (target_path, local_target_branch) =
        workspace_repository_delivery_target(&state, &workspace, &location)?;
    let local_target_head = command_output(
        Path::new(&target_path),
        "git",
        &["rev-parse", &local_target_branch],
    )
    .map_err(AppError::BadRequest)?;
    let (target_head, target_branch, comparison_head) = if input.code_action == "push_branch" {
        let remote = location.remote_name.as_deref().ok_or_else(|| {
            AppError::BadRequest("Workspace Repository has no remote configured".into())
        })?;
        let remote_branch = location.remote_branch.as_deref().ok_or_else(|| {
            AppError::BadRequest("Workspace Repository has no remote branch configured".into())
        })?;
        let remote_head = remote_branch_head(source_path, remote, remote_branch)?;
        if remote_head.is_some() {
            fetch_remote_branch(source_path, remote, remote_branch)?;
        }
        (
            remote_head.clone().unwrap_or_default(),
            format!("{remote}/{remote_branch}"),
            remote_head
                .map(|_| "FETCH_HEAD".into())
                .unwrap_or(local_target_head),
        )
    } else {
        (
            local_target_head.clone(),
            local_target_branch.clone(),
            local_target_head,
        )
    };
    let target_status = if input.code_action == "local_merge" {
        command_output(Path::new(&target_path), "git", &["status", "--porcelain"])
            .map_err(AppError::BadRequest)?
    } else {
        String::new()
    };
    let counts = command_output(
        Path::new(source_path),
        "git",
        &[
            "rev-list",
            "--left-right",
            "--count",
            &format!("{comparison_head}...{source_head}"),
        ],
    )
    .unwrap_or_else(|_| "0\t0".into());
    let mut values = counts
        .split_whitespace()
        .filter_map(|v| v.parse::<i64>().ok());
    let behind = values.next().unwrap_or(0);
    let ahead = values.next().unwrap_or(0);
    let changed_files = command_output(
        Path::new(source_path),
        "git",
        &[
            "diff",
            "--name-only",
            &format!("{comparison_head}...{source_head}"),
        ],
    )
    .unwrap_or_default()
    .lines()
    .map(str::to_owned)
    .collect();
    let commits = parse_git_history(
        &command_output(
            Path::new(source_path),
            "git",
            &[
                "log",
                "--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1e",
                &format!("{comparison_head}..{source_head}"),
            ],
        )
        .unwrap_or_default(),
    );
    let mut blockers = Vec::new();
    let mut warnings = Vec::new();
    if input.code_action == "local_merge" {
        if !target_status.is_empty() {
            blockers.push("merge target working tree is dirty".into());
        }
        if workspace.kind == "workspace" {
            let current = command_output(
                Path::new(&target_path),
                "git",
                &["branch", "--show-current"],
            )
            .unwrap_or_default();
            if current != local_target_branch {
                blockers.push(format!(
                    "merge target must be on branch {local_target_branch}; currently on {current}"
                ));
            }
        }
    }
    if !source_status.is_empty() {
        blockers.push(
            "Workspace has uncommitted changes; commit or discard them in Shell before finishing"
                .into(),
        );
    }
    if input.code_action == "push_branch"
        && !target_head.is_empty()
        && !git_is_ancestor(source_path, &target_head, &source_head)?
    {
        blockers.push(format!(
            "Workspace branch cannot fast-forward remote feature branch {target_branch}"
        ));
    }
    if behind > 0 {
        warnings.push(format!("source is {behind} commit(s) behind its target"));
    }
    let source_dirty = !source_status.is_empty();
    let target_dirty = !target_status.is_empty();
    let preflight = DeliveryPreflight {
        id: id_for_operation(),
        workspace_repository_id: location.id.clone(),
        workspace_id: workspace.id,
        code_action: input.code_action,
        source_head,
        target_head,
        target_branch,
        source_status,
        source_dirty,
        target_dirty,
        ahead,
        behind,
        changed_files,
        commits,
        diff_stat: command_output(
            Path::new(source_path),
            "git",
            &[
                "diff",
                "--stat",
                &format!(
                    "{}...HEAD",
                    location.start_commit.as_deref().unwrap_or("HEAD")
                ),
            ],
        )
        .unwrap_or_default(),
        blockers,
        warnings,
        created_at: now(),
    };
    state.store.create_delivery_preflight(&preflight)?;
    Ok((StatusCode::CREATED, Json(preflight)))
}

#[derive(Clone, Deserialize)]
pub(super) struct CreateDeliveryPreflight {
    pub(super) code_action: String,
}

pub(super) async fn create_delivery_preflight(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<CreateDeliveryPreflight>,
) -> Result<(StatusCode, Json<DeliveryPreflight>)> {
    blocking_git_operation(move || {
        create_delivery_preflight_impl(&state, &id, &input)
            .map(|preflight| (StatusCode::CREATED, Json(preflight)))
    })
    .await
}

pub(super) fn create_delivery_preflight_impl(
    state: &AppState,
    id: &str,
    input: &CreateDeliveryPreflight,
) -> Result<DeliveryPreflight> {
    let location = state.store.default_workspace_repository(id)?;
    let (_, Json(preflight)) =
        create_workspace_repository_preflight_impl(state.clone(), location.id, input.clone())?;
    Ok(preflight)
}

pub(super) async fn validate_preflight_snapshot(
    state: &AppState,
    workspace: &Workspace,
    target_path: &str,
    target_branch: &str,
    input: &FinishWorkspace,
) -> Result<()> {
    let preflight_id = input.preflight_id.as_deref().ok_or_else(|| {
        AppError::BadRequest("run delivery preflight before closing this Workspace".into())
    })?;
    let preflight = state.store.delivery_preflight(preflight_id)?;
    let default_location_id = state.store.default_workspace_repository(&workspace.id)?.id;
    if preflight.workspace_repository_id != default_location_id
        || preflight.code_action != input.code_action
    {
        return Err(AppError::BadRequest(
            "delivery preflight does not match this Workspace and code action".into(),
        ));
    }
    if !preflight.blockers.is_empty() {
        return Err(AppError::BadRequest(format!(
            "delivery preflight is blocked: {}",
            preflight.blockers.join("; ")
        )));
    }
    let source_head = git_head(&workspace.checkout_path)?;
    if input.code_action == "push_branch" {
        let remote = workspace
            .remote_name
            .as_deref()
            .ok_or_else(|| AppError::BadRequest("Workspace has no remote configured".into()))?;
        let remote_branch = workspace.remote_branch.as_deref().ok_or_else(|| {
            AppError::BadRequest("Workspace has no remote branch configured".into())
        })?;
        let remote_head = remote_branch_head(&workspace.checkout_path, remote, remote_branch)?
            .unwrap_or_default();
        let source_status = command_output(
            Path::new(&workspace.checkout_path),
            "git",
            &["status", "--porcelain"],
        )
        .map_err(AppError::BadRequest)?;
        if preflight.source_head != source_head
            || preflight.source_status != source_status
            || preflight.target_head != remote_head
        {
            return Err(AppError::BadRequest(
                "delivery preflight is stale; source or remote feature branch changed".into(),
            ));
        }
        return Ok(());
    }
    let repository_root = repository_root_for_directory(state, &workspace.project_directory_id)?;
    let target_head = if input.code_action == "local_merge" {
        git_head(target_path)?
    } else {
        command_output(
            Path::new(&repository_root),
            "git",
            &["rev-parse", target_branch],
        )
        .map_err(AppError::BadRequest)?
    };
    let source_status = command_output(
        Path::new(&workspace.checkout_path),
        "git",
        &["status", "--porcelain"],
    )
    .map_err(AppError::BadRequest)?;
    if preflight.source_head != source_head
        || preflight.target_head != target_head
        || preflight.target_branch != target_branch
        || preflight.source_status != source_status
    {
        return Err(AppError::BadRequest(
            "delivery preflight is stale; source or target Git state changed".into(),
        ));
    }
    Ok(())
}
