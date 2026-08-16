use super::*;

pub(super) async fn create_workspace_location_preflight(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<CreateDeliveryPreflight>,
) -> Result<(StatusCode, Json<DeliveryPreflight>)> {
    blocking_git_operation(move || create_workspace_location_preflight_impl(state, id, input)).await
}

pub(super) fn create_workspace_location_preflight_impl(
    state: AppState,
    id: String,
    input: CreateDeliveryPreflight,
) -> Result<(StatusCode, Json<DeliveryPreflight>)> {
    let location = state.store.workspace_location(&id)?;
    let workspace = state.store.workspace(&location.workspace_id)?;
    let source_path = workspace_location_git_path(&location)?;
    let source_head = git_head(source_path)?;
    let source_status = command_output(Path::new(source_path), "git", &["status", "--porcelain"])
        .map_err(AppError::BadRequest)?;
    let (target_path, target_branch) =
        workspace_location_delivery_target(&state, &workspace, &location)?;
    let target_head = command_output(Path::new(&target_path), "git", &["rev-parse", "HEAD"])
        .map_err(AppError::BadRequest)?;
    let target_status = command_output(Path::new(&target_path), "git", &["status", "--porcelain"])
        .map_err(AppError::BadRequest)?;
    let counts = command_output(
        Path::new(source_path),
        "git",
        &[
            "rev-list",
            "--left-right",
            "--count",
            &format!("{target_head}...{source_head}"),
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
            &format!("{target_head}...{source_head}"),
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
                &format!("{target_head}..{source_head}"),
            ],
        )
        .unwrap_or_default(),
    );
    let mut blockers = Vec::new();
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
            if current != target_branch {
                blockers.push(format!("main directory must stay on configured base branch {target_branch}; Treefold will not switch it"));
            }
        }
    }
    let mut warnings = Vec::new();
    if !source_status.is_empty() {
        warnings.push(
            "source worktree has uncommitted changes; finishing requires a commit message".into(),
        );
    }
    if behind > 0 {
        warnings.push(format!("source is {behind} commit(s) behind its target"));
    }
    let source_dirty = !source_status.is_empty();
    let target_dirty = !target_status.is_empty();
    let preflight = DeliveryPreflight {
        id: id_for_operation(),
        workspace_location_id: location.id.clone(),
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
    if !["local_merge", "remote_merged", "keep", "discard"].contains(&input.code_action.as_str()) {
        return Err(AppError::BadRequest("invalid code action".into()));
    }
    let workspace = state.store.workspace(id)?;
    if workspace.status != "active" || workspace.kind == "base" {
        return Err(AppError::BadRequest(
            "delivery preflight is available only for an active managed Workspace".into(),
        ));
    }
    let directory = state.store.directory(&workspace.project_directory_id)?;
    let project = state.store.project(&workspace.project_id)?;
    let (target_path, target_branch) = workspace_delivery_target(state, &workspace)?;

    if workspace.kind == "fork" && input.code_action == "remote_merged" {
        return Err(AppError::BadRequest(
            "a Fork has no remote delivery target; merge it into its parent Workspace locally"
                .into(),
        ));
    }

    let source_head = git_head(&workspace.checkout_path)?;
    let (target_head, target_status) = match input.code_action.as_str() {
        "remote_merged" => {
            let remote = project.preferred_remote.as_deref().ok_or_else(|| {
                AppError::BadRequest("Project has no preferred remote target".into())
            })?;
            fetch_remote_branch(&directory.path, remote, &target_branch)?;
            let head = command_output(
                Path::new(&directory.path),
                "git",
                &["rev-parse", "FETCH_HEAD"],
            )
            .map_err(AppError::BadRequest)?;
            (head, String::new())
        }
        "local_merge" => {
            let head = git_head(&target_path)?;
            let status = command_output(Path::new(&target_path), "git", &["status", "--porcelain"])
                .map_err(AppError::BadRequest)?;
            (head, status)
        }
        _ => {
            let head = command_output(
                Path::new(&directory.path),
                "git",
                &["rev-parse", &target_branch],
            )
            .map_err(AppError::BadRequest)?;
            (head, String::new())
        }
    };
    let source_status = command_output(
        Path::new(&workspace.checkout_path),
        "git",
        &["status", "--porcelain"],
    )
    .map_err(AppError::BadRequest)?;
    let counts = command_output(
        Path::new(&workspace.checkout_path),
        "git",
        &[
            "rev-list",
            "--left-right",
            "--count",
            &format!("{target_head}...{source_head}"),
        ],
    )
    .map_err(AppError::BadRequest)?;
    let mut count_fields = counts.split_whitespace();
    let behind = count_fields
        .next()
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or_default();
    let ahead = count_fields
        .next()
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or_default();
    let range = format!("{target_head}..{source_head}");
    let log = command_output(
        Path::new(&workspace.checkout_path),
        "git",
        &[
            "log",
            "-100",
            "--date=iso-strict",
            "--pretty=format:%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e",
            &range,
        ],
    )
    .map_err(AppError::BadRequest)?;
    let mut changed_files = command_output(
        Path::new(&workspace.checkout_path),
        "git",
        &[
            "diff",
            "--name-only",
            &format!("{target_head}...{source_head}"),
        ],
    )
    .map_err(AppError::BadRequest)?
    .lines()
    .map(str::to_owned)
    .collect::<HashSet<_>>();
    for file in command_output(
        Path::new(&workspace.checkout_path),
        "git",
        &["diff", "--name-only", "HEAD"],
    )
    .map_err(AppError::BadRequest)?
    .lines()
    {
        changed_files.insert(file.to_owned());
    }
    for file in command_output(
        Path::new(&workspace.checkout_path),
        "git",
        &["ls-files", "--others", "--exclude-standard"],
    )
    .map_err(AppError::BadRequest)?
    .lines()
    {
        changed_files.insert(file.to_owned());
    }
    let mut changed_files = changed_files.into_iter().collect::<Vec<_>>();
    changed_files.sort();
    let committed_stat = command_output(
        Path::new(&workspace.checkout_path),
        "git",
        &["diff", "--stat", &format!("{target_head}...{source_head}")],
    )
    .map_err(AppError::BadRequest)?;
    let working_stat = command_output(
        Path::new(&workspace.checkout_path),
        "git",
        &["diff", "--stat", "HEAD"],
    )
    .map_err(AppError::BadRequest)?;
    let diff_stat = [committed_stat, working_stat]
        .into_iter()
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join("\n");

    let mut blockers = Vec::new();
    if input.code_action == "local_merge" && !target_status.is_empty() {
        blockers.push("merge target has uncommitted changes".into());
    }
    let checked_out = command_output(
        Path::new(&target_path),
        "git",
        &["branch", "--show-current"],
    )
    .map_err(AppError::BadRequest)?;
    if input.code_action == "local_merge" && checked_out != target_branch {
        blockers.push(format!(
            "merge target must be on branch {target_branch}; currently on {checked_out}"
        ));
    }
    if input.code_action == "remote_merged"
        && !git_is_ancestor(&workspace.checkout_path, &source_head, &target_head)?
    {
        blockers.push(format!(
            "Workspace HEAD is not contained in the remote target {target_branch}"
        ));
    }
    if input.code_action == "remote_merged" && !source_status.is_empty() {
        blockers.push("remote delivery requires a clean Workspace checkout".into());
    }
    if let Some(rebase) = state.store.latest_rebase_operation(id)?
        && rebase_operation_blocks(&rebase)
    {
        blockers.push(format!("Workspace rebase is {}", rebase.status));
    }

    let mut warnings = Vec::new();
    if !source_status.is_empty() {
        warnings.push(
            "source workspace has uncommitted changes; delivery requires a final commit message"
                .into(),
        );
    }
    if behind > 0 {
        warnings.push(format!(
            "source is {behind} commit(s) behind its merge target"
        ));
    }
    let preflight = DeliveryPreflight {
        id: Uuid::new_v4().simple().to_string(),
        workspace_id: id.to_owned(),
        workspace_location_id: state.store.default_workspace_location(id)?.id,
        code_action: input.code_action.clone(),
        source_head,
        target_head,
        target_branch,
        source_dirty: !source_status.is_empty(),
        source_status,
        target_dirty: !target_status.is_empty(),
        ahead,
        behind,
        changed_files,
        commits: parse_git_history(&log),
        diff_stat,
        blockers,
        warnings,
        created_at: now(),
    };
    state.store.create_delivery_preflight(&preflight)?;
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
    let default_location_id = state.store.default_workspace_location(&workspace.id)?.id;
    if preflight.workspace_location_id != default_location_id
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
    let directory = state.store.directory(&workspace.project_directory_id)?;
    let project = state.store.project(&workspace.project_id)?;
    let target_head = match input.code_action.as_str() {
        "remote_merged" => {
            let remote = project.preferred_remote.as_deref().ok_or_else(|| {
                AppError::BadRequest("Project has no preferred remote target".into())
            })?;
            fetch_remote_branch_async(&directory.path, remote, target_branch).await?;
            command_output(
                Path::new(&directory.path),
                "git",
                &["rev-parse", "FETCH_HEAD"],
            )
            .map_err(AppError::BadRequest)?
        }
        "local_merge" => git_head(target_path)?,
        _ => command_output(
            Path::new(&directory.path),
            "git",
            &["rev-parse", target_branch],
        )
        .map_err(AppError::BadRequest)?,
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
