use super::*;

pub(super) async fn list_projects(State(state): State<AppState>) -> Result<Json<Vec<Project>>> {
    Ok(Json(state.store.projects()?))
}

pub(super) async fn list_project_summaries(
    State(state): State<AppState>,
) -> Result<Json<Vec<ProjectSummary>>> {
    Ok(Json(state.store.project_summaries_async().await?))
}

pub(super) async fn get_sidebar(State(state): State<AppState>) -> Result<Json<SidebarData>> {
    reconcile_daemon_sessions(&state).await?;
    Ok(Json(state.store.sidebar_async().await?))
}

#[derive(Deserialize)]
pub(super) struct CreateProject {
    pub(super) name: Option<String>,
    pub(super) description: Option<String>,
    pub(super) path: Option<String>,
    pub(super) preferred_remote: Option<String>,
    pub(super) default_base_branch: Option<String>,
    pub(super) default_target_branch: Option<String>,
    pub(super) default_delivery_mode: Option<String>,
    pub(super) directory_description: Option<String>,
    pub(super) directory_worktree_setup_command: Option<String>,
}
pub(super) async fn create_project(
    State(state): State<AppState>,
    ApiJson(input): ApiJson<CreateProject>,
) -> Result<(StatusCode, Json<Project>)> {
    let timestamp = now();
    let project_id = id();
    let name = trimmed(input.name)
        .filter(|v| !v.is_empty())
        .or_else(|| input.path.as_deref().map(basename))
        .ok_or_else(|| AppError::BadRequest("name is required".into()))?;
    let default_base_branch = trimmed(input.default_base_branch)
        .or_else(|| trimmed(input.default_target_branch))
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "main".into());
    let default_delivery_mode = trimmed(input.default_delivery_mode)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "remote_review".into());
    if default_delivery_mode != "remote_review" && default_delivery_mode != "local_merge" {
        return Err(AppError::BadRequest(
            "default_delivery_mode must be remote_review or local_merge".into(),
        ));
    }
    let inspected_path = input
        .path
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(|path| {
            let inspected = inspect_path(path)?;
            if !inspected.1 {
                return Err(AppError::BadRequest(
                    "a Project's first location must be a ready Git repository".into(),
                ));
            }
            Ok(inspected)
        })
        .transpose()?;
    let project = Project {
        id: project_id.clone(),
        name,
        description: trimmed(input.description).unwrap_or_default(),
        status: "active".into(),
        default_location_id: None,
        default_base_branch: default_base_branch.clone(),
        default_delivery_mode,
        created_at: timestamp.clone(),
        updated_at: timestamp.clone(),
        primary_directory_id: String::new(),
        git_common_dir: String::new(),
        preferred_remote: None,
        default_target_branch: default_base_branch,
    };
    state.store.create_empty_project(&project)?;
    if let Some((path, is_git)) = inspected_path {
        let mut location = ProjectLocation {
            id: id(),
            project_id: project_id.clone(),
            name: basename(&path),
            description: trimmed(input.directory_description).unwrap_or_default(),
            worktree_setup_command: trimmed(input.directory_worktree_setup_command)
                .unwrap_or_default(),
            path,
            repository_url: None,
            preferred_remote_name: trimmed(input.preferred_remote).filter(|v| !v.is_empty()),
            base_branch: Some(project.default_base_branch.clone()),
            delivery_mode: Some(project.default_delivery_mode.clone()),
            git_common_dir: None,
            git_status: if is_git { "ready" } else { "not_git" }.into(),
            last_checked_at: None,
            created_at: timestamp.clone(),
            updated_at: timestamp,
            checkout_path: None,
            role: "default".into(),
            is_git,
            remote_url: None,
            branch: None,
            head_commit: None,
            head_summary: None,
            dirty: false,
        };
        refresh_location_observation(&mut location)?;
        state.store.create_directory(&location)?;
    }
    Ok((StatusCode::CREATED, Json(state.store.project(&project_id)?)))
}

#[derive(Deserialize)]
pub(super) struct UpdateProject {
    pub(super) name: Option<String>,
    pub(super) description: Option<String>,
    pub(super) status: Option<String>,
    #[serde(rename = "default_directory_id", alias = "default_location_id")]
    pub(super) default_location_id: Option<String>,
    pub(super) default_base_branch: Option<String>,
    pub(super) default_delivery_mode: Option<String>,
}

pub(super) async fn update_project(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<UpdateProject>,
) -> Result<Json<Project>> {
    let current = state.store.project(&id)?;
    if current.status == "archived" {
        let restoring = input.status.as_deref() == Some("active")
            && input.name.is_none()
            && input.description.is_none()
            && input.default_location_id.is_none()
            && input.default_base_branch.is_none()
            && input.default_delivery_mode.is_none();
        if !restoring {
            return Err(AppError::BadRequest(
                "Archived Projects are read-only; restore the Project before editing it".into(),
            ));
        }
    }
    let status = input.status.as_deref().unwrap_or(&current.status);
    if status != "active" && status != "archived" {
        return Err(AppError::BadRequest(
            "Project status must be active or archived".into(),
        ));
    }
    if let Some(default_id) = input.default_location_id.as_deref() {
        let mut location = state.store.directory(default_id)?;
        if location.project_id != id {
            return Err(AppError::BadRequest(
                "primary location must belong to this Project".into(),
            ));
        }
        refresh_location_observation(&mut location)?;
        if location.git_status != "ready" {
            return Err(AppError::BadRequest(
                "primary location must be a ready Git repository".into(),
            ));
        }
    }
    if input.name.is_some() || input.description.is_some() {
        let name = input
            .name
            .as_deref()
            .map(str::trim)
            .unwrap_or(&current.name);
        if name.is_empty() {
            return Err(AppError::BadRequest("Project name cannot be empty".into()));
        }
        let description = input.description.as_deref().unwrap_or(&current.description);
        state.store.rename_project(&id, name, description)?;
    }
    if status == "archived" && current.status != "archived" {
        let active = state
            .store
            .workspaces(&id)?
            .into_iter()
            .filter(|workspace| workspace.kind != "base" && workspace.status == "active")
            .map(|workspace| workspace.name)
            .collect::<Vec<_>>();
        if !active.is_empty() {
            return Err(AppError::BadRequest(format!(
                "Finish active Workspaces and Forks before archiving this Project: {}",
                active.join(", ")
            )));
        }
        for workspace in state.store.workspaces(&id)? {
            for mut session in state.store.sessions(&workspace.id)? {
                capture_codex_session_id(&state.store, &mut session)?;
                let _ = state
                    .terminals
                    .stop_existing(&session.amux_workspace_name, &session.amux_process_name)
                    .await;
                state.store.set_session_status(&session.id, "stopped")?;
            }
        }
    }
    if input.status.is_some() {
        state.store.update_project_status(&id, status)?;
    }
    if input.default_location_id.is_some()
        || input.default_base_branch.is_some()
        || input.default_delivery_mode.is_some()
    {
        let default_id = input
            .default_location_id
            .as_deref()
            .or(current.default_location_id.as_deref());
        let branch = input
            .default_base_branch
            .as_deref()
            .unwrap_or(&current.default_base_branch);
        let mode = input
            .default_delivery_mode
            .as_deref()
            .unwrap_or(&current.default_delivery_mode);
        state
            .store
            .update_project_defaults(&id, default_id, branch, mode)?;
    }
    Ok(Json(state.store.project(&id)?))
}

pub(super) async fn get_project(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<ProjectDetail>> {
    let mut detail = state.store.project_detail(&id)?;
    let tracked_workspaces = state.store.workspaces(&id)?;
    let mut tracked_workspace_locations = Vec::new();
    for workspace in &tracked_workspaces {
        tracked_workspace_locations.extend(state.store.workspace_locations(&workspace.id)?);
    }
    let cache_key = id.clone();
    let locations = state
        .store
        .repositories(&id)?
        .iter()
        .map(|repository| state.store.repository_as_directory(&repository.id))
        .collect::<Result<Vec<_>>>()?;
    detail.worktrees = project_worktrees_cache()
        .get_with(cache_key, async move {
            blocking_git_operation(move || {
                Ok(project_worktrees(
                    &locations,
                    &tracked_workspaces,
                    &tracked_workspace_locations,
                ))
            })
            .await
            .unwrap_or_default()
        })
        .await;
    detail.sessions = refresh_session_records(&state, detail.sessions).await?;
    Ok(Json(detail))
}

pub(super) async fn get_project_git_history(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<GitHistory>> {
    let project = state.store.project(&id)?;
    let directory = state.store.directory(&project.primary_directory_id)?;
    if !directory.is_git {
        return Ok(Json(GitHistory {
            branch: String::new(),
            commits: Vec::new(),
        }));
    }
    Ok(Json(git_history(&directory.path)?))
}

pub(super) async fn reveal_project(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<StatusCode> {
    let project = state.store.project(&id)?;
    let directory = state.store.directory(&project.primary_directory_id)?;
    reveal_in_file_manager(&directory.path)?;
    Ok(StatusCode::NO_CONTENT)
}

pub(super) async fn reveal_workspace(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<StatusCode> {
    let workspace = state.store.workspace(&id)?;
    reveal_in_file_manager(&workspace.checkout_path)?;
    Ok(StatusCode::NO_CONTENT)
}

pub(super) async fn get_project_reconciliation(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<ReconciliationReport>> {
    reconcile_project(&state, &id).map(Json)
}

#[derive(Deserialize)]
pub(super) struct RepairProject {
    issue_id: String,
    action: String,
}

pub(super) async fn repair_project(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<RepairProject>,
) -> Result<Json<RepairResult>> {
    repair_project_impl(&state, &id, &input).map(Json)
}

pub(super) fn repair_project_impl(
    state: &AppState,
    project_id: &str,
    input: &RepairProject,
) -> Result<RepairResult> {
    let before = reconcile_project(state, project_id)?;
    let issue = before
        .issues
        .iter()
        .find(|issue| issue.id == input.issue_id)
        .ok_or_else(|| AppError::BadRequest("reconciliation issue is no longer present".into()))?;
    if !issue.actions.iter().any(|action| action == &input.action) {
        return Err(AppError::BadRequest(format!(
            "repair action {} is not allowed for issue {}",
            input.action, input.issue_id
        )));
    }

    let project = state.store.project(project_id)?;
    let directory = state.store.directory(&project.primary_directory_id)?;
    match input.action.as_str() {
        "prune_stale_registration" => {
            command_output(
                Path::new(&directory.path),
                "git",
                &["worktree", "prune", "--expire", "now"],
            )
            .map_err(|error| AppError::BadRequest(format!("prune worktrees: {error}")))?;
        }
        "repair_registration" => {
            let path = issue.path.as_deref().ok_or_else(|| {
                AppError::Internal(anyhow::anyhow!("registration repair is missing its path"))
            })?;
            command_output(
                Path::new(&directory.path),
                "git",
                &["worktree", "repair", path],
            )
            .map_err(|error| {
                AppError::BadRequest(format!("repair worktree registration: {error}"))
            })?;
        }
        _ => {
            return Err(AppError::BadRequest("unknown repair action".into()));
        }
    }

    let report = reconcile_project(state, project_id)?;
    Ok(RepairResult {
        action: input.action.clone(),
        changed: !report.issues.iter().any(|candidate| {
            candidate.id == input.issue_id
                && candidate
                    .actions
                    .iter()
                    .any(|action| action == &input.action)
        }),
        report,
    })
}

pub(super) fn reconcile_project(
    state: &AppState,
    project_id: &str,
) -> Result<ReconciliationReport> {
    let project = state.store.project(project_id)?;
    let directory = state.store.directory(&project.primary_directory_id)?;
    if !directory.is_git {
        return Ok(ReconciliationReport {
            project_id: project.id,
            checked_at: now(),
            issues: Vec::new(),
        });
    }

    let workspaces = state.store.workspaces(project_id)?;
    let listed = git_worktrees(&directory.path)?;
    let branches = git_ref_names(&directory.path, "refs/heads")?;
    let managed_paths = workspaces
        .iter()
        .filter(|workspace| workspace.checkout_mode == "worktree")
        .map(|workspace| normalized_path(&workspace.checkout_path))
        .collect::<HashSet<_>>();
    let mut issues = Vec::new();

    for workspace in workspaces
        .iter()
        .filter(|workspace| workspace.checkout_mode == "worktree")
    {
        let expected_path = normalized_path(&workspace.checkout_path);
        let registered = listed
            .iter()
            .find(|item| normalized_path(&item.path) == expected_path);
        let path_exists = Path::new(&workspace.checkout_path).exists();
        let branch_exists = branches.iter().any(|branch| branch == &workspace.branch);

        if workspace.status == "active" && !path_exists {
            issues.push(reconciliation_issue(
                "managed_worktree_directory_missing",
                "error",
                format!(
                    "Workspace '{}' expects a managed worktree directory that is missing",
                    workspace.name
                ),
                Some(workspace),
                Some(&workspace.checkout_path),
                if registered.is_some() {
                    vec!["prune_stale_registration".into()]
                } else {
                    Vec::new()
                },
            ));
        } else if workspace.status == "active" && registered.is_none() {
            issues.push(reconciliation_issue(
                "managed_worktree_unregistered",
                "error",
                format!(
                    "Workspace '{}' has a directory but Git does not register it as a worktree",
                    workspace.name
                ),
                Some(workspace),
                Some(&workspace.checkout_path),
                vec!["repair_registration".into()],
            ));
        }

        if workspace.status == "active" && !branch_exists {
            issues.push(reconciliation_issue(
                "managed_branch_missing",
                "error",
                format!(
                    "Workspace '{}' references missing branch {}",
                    workspace.name, workspace.branch
                ),
                Some(workspace),
                Some(&workspace.checkout_path),
                Vec::new(),
            ));
        }

        if let Some(registered) = registered
            && workspace.status == "active"
            && branch_exists
            && registered.branch != workspace.branch
        {
            issues.push(reconciliation_issue(
                "managed_branch_mismatch",
                "error",
                format!(
                    "Workspace '{}' expects branch {}, but its worktree has {}",
                    workspace.name, workspace.branch, registered.branch
                ),
                Some(workspace),
                Some(&workspace.checkout_path),
                Vec::new(),
            ));
        }

        if let Some(operation) = state.store.delivery_operation(&workspace.id)?
            && operation.phase != "archived"
        {
            issues.push(reconciliation_issue(
                "delivery_interrupted",
                "warning",
                format!(
                    "Workspace '{}' has an unfinished delivery at phase {}",
                    workspace.name, operation.phase
                ),
                Some(workspace),
                Some(&workspace.checkout_path),
                Vec::new(),
            ));
        }
        if let Some(operation) = state.store.latest_rebase_operation(&workspace.id)?
            && rebase_operation_blocks(&operation)
        {
            issues.push(reconciliation_issue(
                "rebase_interrupted",
                "warning",
                format!(
                    "Workspace '{}' has an unfinished rebase with status {}",
                    workspace.name, operation.status
                ),
                Some(workspace),
                Some(&workspace.checkout_path),
                Vec::new(),
            ));
        }
        let reset_operation = state.store.latest_reset_operation(&workspace.id)?;
        let reset_operation = if workspace.status == "active"
            && reset_operation
                .as_ref()
                .is_some_and(|operation| operation.status == "active")
        {
            reset_status_impl(state, &workspace.id)?
        } else {
            reset_operation
        };
        if let Some(operation) = reset_operation
            && (operation.status == "active" || operation.status == "failed")
        {
            issues.push(reconciliation_issue(
                if operation.status == "active" {
                    "reset_interrupted"
                } else {
                    "reset_failed"
                },
                "warning",
                format!(
                    "Workspace '{}' has reset status {} with recovery ref {}{}",
                    workspace.name,
                    operation.status,
                    operation.recovery_ref,
                    if operation.error.is_empty() {
                        String::new()
                    } else {
                        format!(": {}", operation.error)
                    }
                ),
                Some(workspace),
                Some(&workspace.checkout_path),
                Vec::new(),
            ));
        }
    }

    for worktree in listed.iter().filter(|worktree| !worktree.is_main) {
        let path = normalized_path(&worktree.path);
        if managed_paths.contains(&path) {
            continue;
        }
        let path_exists = Path::new(&worktree.path).exists();
        issues.push(reconciliation_issue(
            "orphan_worktree_registration",
            if path_exists { "warning" } else { "error" },
            if path_exists {
                format!(
                    "Git worktree {} is not owned by any Treefold Workspace",
                    worktree.path
                )
            } else {
                format!(
                    "Git retains a stale worktree registration for missing path {}",
                    worktree.path
                )
            },
            None,
            Some(&worktree.path),
            if path_exists {
                Vec::new()
            } else {
                vec!["prune_stale_registration".into()]
            },
        ));
    }

    issues.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(ReconciliationReport {
        project_id: project.id,
        checked_at: now(),
        issues,
    })
}

pub(super) fn reconciliation_issue(
    kind: &str,
    severity: &str,
    message: String,
    workspace: Option<&Workspace>,
    path: Option<&str>,
    actions: Vec<String>,
) -> ReconciliationIssue {
    let identity = workspace
        .map(|workspace| workspace.id.as_str())
        .or(path)
        .unwrap_or("project");
    ReconciliationIssue {
        id: format!("{kind}:{identity}"),
        kind: kind.into(),
        severity: severity.into(),
        message,
        workspace_id: workspace.map(|workspace| workspace.id.clone()),
        path: path.map(str::to_owned),
        actions,
    }
}

#[derive(Deserialize)]
pub(super) struct DeleteWorktree {
    path: String,
}

pub(super) async fn delete_worktree(
    State(state): State<AppState>,
    AxumPath(repository_id): AxumPath<String>,
    ApiJson(input): ApiJson<DeleteWorktree>,
) -> Result<StatusCode> {
    let (project_id, repository_path, worktree_path) = blocking_git_operation(move || {
        prepare_delete_worktree(&state, &repository_id, &input.path)
    })
    .await?;
    let worktrees_cache = project_worktrees_cache();
    if let Some(mut worktrees) = worktrees_cache.get(&project_id).await {
        let target = normalized_path(&worktree_path);
        worktrees.retain(|worktree| normalized_path(&worktree.path) != target);
        worktrees_cache.insert(project_id.clone(), worktrees).await;
    }

    let removal_path = worktree_path.clone();
    blocking_git_operation(move || {
        command_output(
            Path::new(&repository_path),
            "git",
            &["worktree", "remove", &removal_path],
        )
        .map_err(AppError::BadRequest)
    })
    .await?;
    project_worktrees_cache().invalidate(&project_id).await;
    Ok(StatusCode::NO_CONTENT)
}

fn prepare_delete_worktree(
    state: &AppState,
    repository_id: &str,
    worktree_path: &str,
) -> Result<(String, String, String)> {
    let directory = state.store.repository_as_directory(repository_id)?;
    ensure_active_project(&state.store.project(&directory.project_id)?)?;
    if !directory.is_git {
        return Err(AppError::BadRequest(
            "directory is not a Git repository".into(),
        ));
    }

    let target = normalized_path(worktree_path);
    let project_directories = state.store.directories(&directory.project_id)?;
    if project_directories
        .iter()
        .any(|item| normalized_path(&item.path) == target)
    {
        return Err(AppError::BadRequest(
            "a Project directory cannot be removed as a worktree".into(),
        ));
    }
    let listed = git_worktrees(&directory.path)?;
    let Some(listed_worktree) = listed
        .iter()
        .find(|item| normalized_path(&item.path) == target)
    else {
        return Err(AppError::BadRequest(
            "worktree does not belong to this Git repository".into(),
        ));
    };
    if listed_worktree.is_main {
        return Err(AppError::BadRequest(
            "the repository's main worktree cannot be removed".into(),
        ));
    }

    if let Some(workspace) = state
        .store
        .workspaces(&directory.project_id)?
        .into_iter()
        .find(|item| item.status == "active" && normalized_path(&item.checkout_path) == target)
    {
        return Err(AppError::BadRequest(format!(
            "worktree belongs to active Workspace '{}'; use Finish Workspace",
            workspace.name
        )));
    }

    if Path::new(worktree_path).exists() {
        let tracked_status = Command::new("git")
            .current_dir(worktree_path)
            .args(["diff-index", "--quiet", "HEAD", "--"])
            .status()
            .map_err(|error| AppError::BadRequest(format!("check worktree changes: {error}")))?;
        match tracked_status.code() {
            Some(0) => {}
            Some(1) => {
                return Err(AppError::BadRequest(
                    "worktree has uncommitted tracked changes; commit or stash them before deleting it"
                        .into(),
                ));
            }
            _ => {
                return Err(AppError::BadRequest(
                    "failed to check worktree tracked changes".into(),
                ));
            }
        }

        let untracked = command_output(
            Path::new(worktree_path),
            "git",
            &[
                "ls-files",
                "--others",
                "--exclude-standard",
                "--directory",
                "--no-empty-directory",
            ],
        )
        .map_err(AppError::BadRequest)?;
        if !untracked.is_empty() {
            return Err(AppError::BadRequest(
                "worktree has uncommitted changes; commit, stash, or discard them before deleting it"
                    .into(),
            ));
        }
    }

    Ok((
        directory.project_id,
        directory.path,
        worktree_path.to_owned(),
    ))
}

pub(super) async fn delete_project(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<StatusCode> {
    if state.store.project(&id)?.status != "archived" {
        return Err(AppError::BadRequest(
            "Archive the Project before permanently deleting it".into(),
        ));
    }
    if state
        .store
        .workspaces(&id)?
        .iter()
        .any(|workspace| workspace.kind != "base" && workspace.status == "active")
    {
        return Err(AppError::BadRequest(
            "Finish active Workspaces and Forks before deleting this Project".into(),
        ));
    }
    state.store.delete_project(&id)?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub(super) struct CreateDirectory {
    pub(super) description: Option<String>,
    pub(super) worktree_setup_command: Option<String>,
    pub(super) path: String,
    pub(super) base_branch: Option<String>,
    pub(super) delivery_mode: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct InspectProjectLocation {
    path: String,
    project_id: Option<String>,
}

#[derive(Serialize)]
pub(super) struct ProjectLocationInspection {
    path: String,
    name: String,
    directory_type: String,
    git_status: String,
    source_root: Option<String>,
    git_common_dir: Option<String>,
    relative_path: Option<String>,
    repository_id: Option<String>,
    repository_url: Option<String>,
    preferred_remote_name: Option<String>,
    base_branch: Option<String>,
}

pub(super) async fn inspect_project_location(
    State(state): State<AppState>,
    ApiJson(input): ApiJson<InspectProjectLocation>,
) -> Result<Json<ProjectLocationInspection>> {
    let (path, is_git) = inspect_path(&input.path)?;
    let mut location = ProjectLocation {
        id: String::new(),
        project_id: String::new(),
        name: basename(&path),
        description: String::new(),
        worktree_setup_command: String::new(),
        path,
        repository_url: None,
        preferred_remote_name: None,
        base_branch: None,
        delivery_mode: None,
        git_common_dir: None,
        git_status: if is_git { "ready" } else { "not_git" }.into(),
        last_checked_at: None,
        created_at: String::new(),
        updated_at: String::new(),
        checkout_path: None,
        role: String::new(),
        is_git,
        remote_url: None,
        branch: None,
        head_commit: None,
        head_summary: None,
        dirty: false,
    };
    refresh_location_observation(&mut location)?;
    let source_root = location.checkout_path.clone();
    let relative_path = source_root.as_deref().map(|root| {
        Path::new(&location.path)
            .strip_prefix(root)
            .ok()
            .filter(|value| !value.as_os_str().is_empty())
            .map(|value| value.to_string_lossy().replace('\\', "/"))
            .unwrap_or_else(|| ".".into())
    });
    let repository_id = input.project_id.as_deref().and_then(|project_id| {
        location.git_common_dir.as_deref().and_then(|common| {
            state
                .store
                .repositories(project_id)
                .ok()
                .and_then(|repositories| {
                    repositories
                        .into_iter()
                        .find(|repository| repository.git_common_dir == common)
                        .map(|repository| repository.id)
                })
        })
    });
    Ok(Json(ProjectLocationInspection {
        path: location.path,
        name: location.name,
        directory_type: if location.git_status == "ready" {
            "git_scope"
        } else {
            "external"
        }
        .into(),
        git_status: location.git_status,
        source_root,
        git_common_dir: location.git_common_dir,
        relative_path,
        repository_id,
        repository_url: location.repository_url,
        preferred_remote_name: location.preferred_remote_name,
        base_branch: location.base_branch,
    }))
}

pub(super) async fn list_project_directories(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
) -> Result<Json<Vec<ProjectDirectory>>> {
    state.store.project(&project_id)?;
    Ok(Json(state.store.project_directories(&project_id)?))
}

pub(super) async fn get_project_directory(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<ProjectDirectory>> {
    Ok(Json(state.store.directory_record(&id)?))
}

pub(super) async fn list_project_repositories(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
) -> Result<Json<Vec<ProjectRepository>>> {
    state.store.project(&project_id)?;
    Ok(Json(state.store.repositories(&project_id)?))
}

#[derive(Deserialize)]
pub(super) struct CloneProjectRepository {
    pub(super) url: String,
    pub(super) name: Option<String>,
    pub(super) preferred_remote_name: Option<String>,
    pub(super) delivery_mode: Option<String>,
    pub(super) setup_command: Option<String>,
}

pub(super) async fn clone_project_repository(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    ApiJson(input): ApiJson<CloneProjectRepository>,
) -> Result<(StatusCode, Json<Directory>)> {
    let result =
        blocking_git_operation(move || clone_project_repository_impl(state, project_id, input))
            .await?;
    project_worktrees_cache()
        .invalidate(&result.1.project_id)
        .await;
    Ok(result)
}

pub(super) fn clone_project_repository_impl(
    state: AppState,
    project_id: String,
    input: CloneProjectRepository,
) -> Result<(StatusCode, Json<Directory>)> {
    let project = state.store.project(&project_id)?;
    ensure_active_project(&project)?;
    let url = input.url.trim();
    if url.is_empty() {
        return Err(AppError::BadRequest("Git URL is required".into()));
    }
    let delivery_mode = input.delivery_mode.as_deref().unwrap_or("remote_review");
    if !["remote_review", "local_merge"].contains(&delivery_mode) {
        return Err(AppError::BadRequest(
            "delivery_mode must be remote_review or local_merge".into(),
        ));
    }
    let repository_id = id();
    let source = managed_repository_source_path(&state.settings, &project_id, &repository_id);
    if source.exists() {
        return Err(AppError::api(
            StatusCode::CONFLICT,
            "MANAGED_SOURCE_EXISTS",
            "managed source path already exists",
        ));
    }
    let parent = source
        .parent()
        .ok_or_else(|| AppError::Internal(anyhow::anyhow!("managed source has no parent")))?;
    std::fs::create_dir_all(parent)
        .map_err(|error| AppError::BadRequest(format!("create managed source: {error}")))?;
    let clone_result = command_output(
        parent,
        "git",
        &[
            "clone",
            "--origin",
            "origin",
            url,
            source.to_string_lossy().as_ref(),
        ],
    );
    if let Err(error) = clone_result {
        let _ = std::fs::remove_dir_all(parent);
        return Err(AppError::BadRequest(format!("clone repository: {error}")));
    }
    let source_string = source.to_string_lossy().into_owned();
    let timestamp = now();
    let mut directory = Directory {
        id: id(),
        project_id: project_id.clone(),
        name: input
            .name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| basename(&source_string)),
        description: String::new(),
        worktree_setup_command: input.setup_command.unwrap_or_default(),
        path: source_string,
        repository_url: Some(url.to_owned()),
        preferred_remote_name: Some(
            input
                .preferred_remote_name
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("origin")
                .to_owned(),
        ),
        base_branch: None,
        delivery_mode: Some(delivery_mode.to_owned()),
        git_common_dir: None,
        git_status: "creating".into(),
        last_checked_at: None,
        updated_at: timestamp.clone(),
        checkout_path: None,
        role: "primary".into(),
        is_git: true,
        remote_url: None,
        branch: None,
        head_commit: None,
        head_summary: None,
        dirty: false,
        created_at: timestamp,
    };
    refresh_location_observation(&mut directory)?;
    if directory.git_status != "ready" || directory.git_common_dir.is_none() {
        let _ = std::fs::remove_dir_all(parent);
        return Err(AppError::BadRequest(
            "cloned source is not a ready Git repository".into(),
        ));
    }
    let directory_id = match state
        .store
        .create_directory_with_repository_id(&directory, Some(&repository_id))
    {
        Ok(id) => id,
        Err(error) => {
            let _ = std::fs::remove_dir_all(parent);
            return Err(error);
        }
    };
    let directory = state.store.directory(&directory_id)?;
    Ok((StatusCode::CREATED, Json(directory)))
}

pub(super) async fn get_project_repository(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<ProjectRepository>> {
    Ok(Json(state.store.repository(&id)?))
}
pub(super) async fn create_directory(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    ApiJson(input): ApiJson<CreateDirectory>,
) -> Result<(StatusCode, Json<Directory>)> {
    let project = state.store.project(&project_id)?;
    ensure_active_project(&project)?;
    let (path, is_git) = inspect_path(&input.path)?;
    if project.default_location_id.is_none() && !is_git {
        return Err(AppError::BadRequest(
            "a Project's first location must be a ready Git repository".into(),
        ));
    }
    let name = basename(&path);
    let requested_delivery_mode = trimmed(input.delivery_mode).filter(|value| !value.is_empty());
    if let Some(mode) = requested_delivery_mode.as_deref()
        && mode != "remote_review"
        && mode != "local_merge"
    {
        return Err(AppError::BadRequest(
            "delivery_mode must be remote_review or local_merge".into(),
        ));
    }
    let directory = Directory {
        id: id(),
        project_id,
        name,
        description: trimmed(input.description).unwrap_or_default(),
        worktree_setup_command: trimmed(input.worktree_setup_command).unwrap_or_default(),
        path,
        repository_url: None,
        preferred_remote_name: None,
        base_branch: if is_git {
            trimmed(input.base_branch).filter(|value| !value.is_empty())
        } else {
            None
        },
        delivery_mode: if is_git {
            Some(requested_delivery_mode.unwrap_or_else(|| "remote_review".into()))
        } else {
            None
        },
        git_common_dir: None,
        git_status: if is_git {
            "ready".into()
        } else {
            "not_git".into()
        },
        last_checked_at: None,
        updated_at: now(),
        checkout_path: None,
        role: "attached".into(),
        is_git,
        remote_url: None,
        branch: None,
        head_commit: None,
        head_summary: None,
        dirty: false,
        created_at: now(),
    };
    let mut directory = directory;
    refresh_location_observation(&mut directory)?;
    if project.default_location_id.is_none() && directory.git_status != "ready" {
        return Err(AppError::BadRequest(
            "a Project's first location must be a ready Git repository".into(),
        ));
    }
    if directory.git_status == "ready" && directory.delivery_mode.is_none() {
        directory.delivery_mode = Some("remote_review".into());
    }
    let directory_id = state.store.create_directory(&directory)?;
    let directory = state.store.directory(&directory_id)?;
    location_observations_cache()
        .insert(directory.id.clone(), directory.clone())
        .await;
    project_worktrees_cache()
        .invalidate(&directory.project_id)
        .await;
    Ok((StatusCode::CREATED, Json(directory)))
}

pub(super) async fn refresh_project_location(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<ProjectLocation>> {
    location_observations_cache().invalidate(&id).await;
    let mut location = state.store.directory(&id)?;
    ensure_active_project(&state.store.project(&location.project_id)?)?;
    let was_git = location.git_common_dir.is_some();
    refresh_location_observation(&mut location)?;
    if location.git_status == "ready" {
        if location.delivery_mode.is_none() {
            location.delivery_mode = Some("remote_review".into());
        }
    } else if was_git {
        // Persisted repository identity is intentionally retained when the path
        // is unavailable or no longer points at the same repository.
        location.is_git = false;
    }
    location.updated_at = now();
    state.store.refresh_project_location(&location)?;
    location_observations_cache()
        .insert(id, location.clone())
        .await;
    project_worktrees_cache()
        .invalidate(&location.project_id)
        .await;
    Ok(Json(location))
}

pub(super) async fn refresh_project_repository(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<ProjectRepository>> {
    let repository = state.store.repository(&id)?;
    ensure_active_project(&state.store.project(&repository.project_id)?)?;
    let mut observed = state.store.repository_as_directory(&id)?;
    refresh_location_observation(&mut observed)?;
    let mut updated = repository;
    updated.name = basename(&updated.source_root);
    updated.git_status = observed.git_status;
    // Refresh is observational: repository identity and the user's preferred
    // remote stay stable until an explicit settings change or Relink.
    updated.last_checked_at = observed.last_checked_at;
    updated.updated_at = now();
    if let Some(root) = observed.checkout_path {
        updated.source_root = root;
    }
    if let Some(common) = observed.git_common_dir {
        updated.git_common_dir = common;
    }
    state.store.refresh_repository(&updated)?;
    project_worktrees_cache()
        .invalidate(&updated.project_id)
        .await;
    Ok(Json(state.store.repository(&id)?))
}

#[derive(Deserialize)]
pub(super) struct ReattachProjectLocation {
    path: String,
    preferred_remote_name: Option<String>,
    #[serde(default)]
    confirm_unverified: bool,
}

pub(super) async fn reattach_project_location(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<ReattachProjectLocation>,
) -> Result<Json<ProjectLocation>> {
    let current = state.store.repository_as_directory(&id)?;
    ensure_active_project(&state.store.project(&current.project_id)?)?;
    if current.git_common_dir.is_none() {
        return Err(AppError::BadRequest(
            "only a previously identified Git location can be relinked".into(),
        ));
    }
    let (candidate, is_git) = inspect_path(&input.path)?;
    if !is_git {
        return Err(AppError::BadRequest(
            "relink path is not a Git repository".into(),
        ));
    }
    let git_dir = command_output(
        Path::new(&candidate),
        "git",
        &["rev-parse", "--path-format=absolute", "--git-dir"],
    )
    .map_err(AppError::BadRequest)?;
    let common_dir = command_output(
        Path::new(&candidate),
        "git",
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )
    .map_err(AppError::BadRequest)?;
    if normalized_path(&git_dir) != normalized_path(&common_dir) {
        return Err(AppError::BadRequest(
            "relink path must be the repository main worktree".into(),
        ));
    }
    let mut observed = current.clone();
    observed.path = candidate.clone();
    observed.name = basename(&candidate);
    observed.git_common_dir = None;
    refresh_location_observation(&mut observed)?;
    if observed.git_status != "ready" {
        return Err(AppError::BadRequest(format!(
            "reattach repository is {}",
            observed.git_status
        )));
    }
    let remote_names = git_remote_names(&candidate)?;
    if let Some(expected) = current.repository_url.as_deref() {
        let mut matched = false;
        for remote in &remote_names {
            for flag in ["--all", "--push"] {
                if let Ok(urls) = command_output(
                    Path::new(&candidate),
                    "git",
                    &["remote", "get-url", flag, remote],
                ) {
                    matched |= urls
                        .lines()
                        .any(|url| repository_identity_matches(expected, url));
                }
            }
        }
        if !matched {
            return Err(AppError::BadRequest(
                "relink repository identity does not match any candidate remote".into(),
            ));
        }
    }
    let active_locations = state.store.workspace_locations_for_project_location(&id)?;
    if !active_locations.is_empty() {
        let registered = git_worktrees(&candidate)?;
        for checkout in active_locations
            .iter()
            .filter_map(|item| item.checkout_path.as_deref())
        {
            if !registered
                .iter()
                .any(|item| normalized_path(&item.path) == normalized_path(checkout))
            {
                return Err(AppError::BadRequest(format!(
                    "candidate repository is missing active worktree registration {checkout}"
                )));
            }
        }
    } else if current.repository_url.is_none() && !input.confirm_unverified {
        return Err(AppError::BadRequest(
            "local-only repository cannot be verified; confirm_unverified is required".into(),
        ));
    }
    let preferred = input
        .preferred_remote_name
        .as_deref()
        .or(current.preferred_remote_name.as_deref());
    if let Some(preferred) = preferred
        && !remote_names.iter().any(|name| name == preferred)
    {
        return Err(AppError::BadRequest(
            "preferred remote is missing from candidate; choose a new preferred_remote_name".into(),
        ));
    }
    state.store.reattach_repository(
        &id,
        &candidate,
        &common_dir,
        current.repository_url.as_deref(),
        preferred,
    )?;
    let repository = refresh_project_repository(State(state.clone()), AxumPath(id)).await?;
    Ok(Json(state.store.repository_as_directory(&repository.id)?))
}

pub(super) async fn resync_workspace(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<WorkspaceDetail>> {
    let workspace = state.store.workspace(&id)?;
    ensure_active_workspace(&workspace)?;

    let mut succeeded = 0usize;
    let mut failed = 0usize;
    for location in state.store.workspace_repositories(&id)? {
        let Some(checkout_path) = location.checkout_path.as_deref() else {
            state
                .store
                .set_workspace_location_creation_error(&location.id, "checkout path is missing")?;
            failed += 1;
            continue;
        };
        if !Path::new(checkout_path).is_dir() {
            state.store.set_workspace_location_creation_result(
                &location.id,
                "missing",
                Some(checkout_path),
                location.start_commit.as_deref(),
                Some("checkout directory is missing"),
            )?;
            failed += 1;
            continue;
        }
        let repository = match state.store.repository(&location.project_location_id) {
            Ok(repository) => repository,
            Err(_) => {
                state.store.set_workspace_location_creation_result(
                    &location.id,
                    "broken",
                    Some(checkout_path),
                    location.start_commit.as_deref(),
                    Some("Project repository is missing or removed"),
                )?;
                failed += 1;
                continue;
            }
        };
        if !Path::new(&repository.source_root).is_dir() {
            state.store.set_workspace_location_creation_result(
                &location.id,
                "broken",
                Some(checkout_path),
                location.start_commit.as_deref(),
                Some("Project repository source is missing"),
            )?;
            failed += 1;
            continue;
        }
        let registered = match git_worktrees(&repository.source_root) {
            Ok(registered) => registered,
            Err(error) => {
                state.store.set_workspace_location_creation_result(
                    &location.id,
                    "broken",
                    Some(checkout_path),
                    location.start_commit.as_deref(),
                    Some(&format!("cannot list worktrees: {error}")),
                )?;
                failed += 1;
                continue;
            }
        };
        if !registered
            .iter()
            .any(|item| normalized_path(&item.path) == normalized_path(checkout_path))
        {
            state.store.set_workspace_location_creation_result(
                &location.id,
                "missing",
                Some(checkout_path),
                location.start_commit.as_deref(),
                Some("checkout is not registered as a worktree"),
            )?;
            failed += 1;
            continue;
        }
        if let Err(error) = command_output(
            Path::new(&repository.source_root),
            "git",
            &["worktree", "repair", checkout_path],
        ) {
            state.store.set_workspace_location_creation_result(
                &location.id,
                "broken",
                Some(checkout_path),
                location.start_commit.as_deref(),
                Some(&format!("worktree repair failed: {error}")),
            )?;
            failed += 1;
            continue;
        }
        let probe = command_output(Path::new(checkout_path), "git", &["rev-parse", "--git-dir"]);
        match probe {
            Ok(_) => {
                state.store.set_workspace_location_creation_result(
                    &location.id,
                    "ready",
                    Some(checkout_path),
                    location.start_commit.as_deref(),
                    None,
                )?;
                succeeded += 1;
            }
            Err(error) => {
                state.store.set_workspace_location_creation_result(
                    &location.id,
                    "broken",
                    Some(checkout_path),
                    location.start_commit.as_deref(),
                    Some(&format!("worktree probe failed: {error}")),
                )?;
                failed += 1;
            }
        }
    }

    if succeeded == 0 && failed > 0 {
        return Err(AppError::BadRequest(format!(
            "workspace resync failed for all {failed} repositories"
        )));
    }

    get_workspace(State(state), AxumPath(id)).await
}

pub(super) async fn delete_project_repository(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<StatusCode> {
    let repository = state.store.repository(&id)?;
    ensure_active_project(&state.store.project(&repository.project_id)?)?;
    state.store.delete_repository(&id)?;
    project_worktrees_cache()
        .invalidate(&repository.project_id)
        .await;
    Ok(StatusCode::NO_CONTENT)
}

pub(super) async fn delete_project_location(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<StatusCode> {
    let location = state.store.directory(&id)?;
    let project = state.store.project(&location.project_id)?;
    ensure_active_project(&project)?;
    state.store.delete_project_location(&id)?;
    location_observations_cache().invalidate(&id).await;
    project_worktrees_cache().invalidate(&project.id).await;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub(super) struct UpdateDirectory {
    name: Option<String>,
    description: Option<String>,
    worktree_setup_command: Option<String>,
    base_branch: Option<String>,
    delivery_mode: Option<String>,
}
pub(super) async fn update_directory(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<UpdateDirectory>,
) -> Result<Json<Directory>> {
    let current = state.store.directory(&id)?;
    ensure_active_project(&state.store.project(&current.project_id)?)?;
    let name = trimmed(input.name)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| current.name.clone());
    let base_branch = trimmed(input.base_branch).filter(|value| !value.is_empty());
    let delivery_mode = trimmed(input.delivery_mode).filter(|value| !value.is_empty());
    if current.git_common_dir.is_none() && (base_branch.is_some() || delivery_mode.is_some()) {
        return Err(AppError::BadRequest(
            "Git settings can only be configured for a Git location".into(),
        ));
    }
    if let Some(mode) = delivery_mode.as_deref()
        && mode != "remote_review"
        && mode != "local_merge"
    {
        return Err(AppError::BadRequest(
            "delivery_mode must be remote_review or local_merge".into(),
        ));
    }
    state.store.update_directory(
        &id,
        &name,
        trimmed(input.description).unwrap_or_default().as_str(),
        trimmed(input.worktree_setup_command)
            .unwrap_or_default()
            .as_str(),
        if current.git_common_dir.is_some() {
            base_branch.as_deref().or(current.base_branch.as_deref())
        } else {
            None
        },
        if current.git_common_dir.is_some() {
            delivery_mode
                .as_deref()
                .or(current.delivery_mode.as_deref())
        } else {
            None
        },
    )?;
    let mut directory = state.store.directory(&id)?;
    enrich_directory(&mut directory, None);
    Ok(Json(directory))
}

#[derive(Deserialize)]
pub(super) struct UpdateProjectRepository {
    setup_command: Option<String>,
    setup_workdir: Option<String>,
    base_branch: Option<String>,
    delivery_mode: Option<String>,
}

pub(super) async fn update_project_repository(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<UpdateProjectRepository>,
) -> Result<Json<ProjectRepository>> {
    let current = state.store.repository(&id)?;
    ensure_active_project(&state.store.project(&current.project_id)?)?;
    let base_branch = trimmed(input.base_branch)
        .filter(|value| !value.is_empty())
        .unwrap_or(current.base_branch);
    let delivery_mode = trimmed(input.delivery_mode)
        .filter(|value| !value.is_empty())
        .unwrap_or(current.delivery_mode);
    if delivery_mode != "remote_review" && delivery_mode != "local_merge" {
        return Err(AppError::BadRequest(
            "delivery_mode must be remote_review or local_merge".into(),
        ));
    }
    let setup_workdir = validate_setup_workdir(
        &current.source_root,
        trimmed(input.setup_workdir)
            .filter(|value| !value.is_empty())
            .as_deref()
            .unwrap_or(&current.setup_workdir),
    )?;
    state.store.update_repository(
        &id,
        trimmed(input.setup_command)
            .unwrap_or(current.setup_command)
            .as_str(),
        &setup_workdir,
        &base_branch,
        &delivery_mode,
    )?;
    Ok(Json(state.store.repository(&id)?))
}

#[derive(Deserialize)]
pub(super) struct SetBaseBranch {
    branch: String,
    remote: Option<String>,
}

pub(super) async fn set_project_repository_base_branch(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<SetBaseBranch>,
) -> Result<Json<ProjectRepository>> {
    let repository = state.store.repository(&id)?;
    blocking_git_operation_for(repository.git_common_dir.clone(), move || {
        set_project_repository_base_branch_impl(state, id, input)
    })
    .await
}

pub(super) fn set_project_repository_base_branch_impl(
    state: AppState,
    id: String,
    input: SetBaseBranch,
) -> Result<Json<ProjectRepository>> {
    let repository = state.store.repository(&id)?;
    ensure_active_project(&state.store.project(&repository.project_id)?)?;
    let branch = input.branch.trim();
    if branch.is_empty() {
        return Err(AppError::BadRequest("base branch is required".into()));
    }
    let source = Path::new(&repository.source_root);
    let local_ref = format!("refs/heads/{branch}");
    command_output(
        source,
        "git",
        &["show-ref", "--verify", "--quiet", &local_ref],
    )
    .map_err(|_| AppError::BadRequest("local branch was not found".into()))?;
    let remote = input
        .remote
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(remote) = remote {
        if !git_remote_names(&repository.source_root)?
            .iter()
            .any(|name| name == remote)
        {
            return Err(AppError::BadRequest("remote was not found".into()));
        }
    }
    state.store.update_repository_base(&id, branch, remote)?;
    Ok(Json(state.store.repository(&id)?))
}

pub(super) fn validate_setup_workdir(source_root: &str, value: &str) -> Result<String> {
    let relative = if value.trim().is_empty() {
        "."
    } else {
        value.trim()
    };
    let candidate = std::fs::canonicalize(Path::new(source_root).join(relative))
        .map_err(|error| AppError::BadRequest(format!("invalid setup workdir: {error}")))?;
    let root = std::fs::canonicalize(source_root).map_err(|error| {
        AppError::BadRequest(format!("invalid Repository source root: {error}"))
    })?;
    if !candidate.is_dir() || !candidate.starts_with(&root) {
        return Err(AppError::BadRequest(
            "setup workdir must be an existing directory inside the Repository".into(),
        ));
    }
    let relative = candidate
        .strip_prefix(root)
        .map_err(|_| AppError::BadRequest("setup workdir escapes the Repository".into()))?;
    Ok(if relative.as_os_str().is_empty() {
        ".".into()
    } else {
        relative.to_string_lossy().replace('\\', "/")
    })
}

#[derive(Serialize)]
pub(super) struct GitRemoteBranches {
    pub(super) name: String,
    pub(super) branches: Vec<String>,
}

#[derive(Serialize)]
pub(super) struct GitBranches {
    pub(super) current: String,
    pub(super) local: Vec<String>,
    pub(super) remotes: Vec<GitRemoteBranches>,
}

pub(super) async fn list_directory_branches(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<GitBranches>> {
    blocking_git_operation(move || {
        let directory = state.store.repository_as_directory(&id)?;
        ensure_git_directory(&directory)?;
        Ok(Json(directory_branches(&directory.path)?))
    })
    .await
}

#[derive(Deserialize)]
pub(super) struct DeleteDirectoryBranch {
    kind: String,
    branch: String,
    remote: Option<String>,
}

pub(super) async fn delete_directory_branch(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<DeleteDirectoryBranch>,
) -> Result<Json<GitBranches>> {
    let repository = state.store.repository(&id)?;
    blocking_git_operation_for(repository.git_common_dir.clone(), move || {
        delete_directory_branch_impl(state, id, input)
    })
    .await
}

pub(super) fn delete_directory_branch_impl(
    state: AppState,
    id: String,
    input: DeleteDirectoryBranch,
) -> Result<Json<GitBranches>> {
    let repository = state.store.repository(&id)?;
    ensure_active_project(&state.store.project(&repository.project_id)?)?;
    let branch = input.branch.trim();
    if branch.is_empty() {
        return Err(AppError::BadRequest("branch is required".into()));
    }
    let source = Path::new(&repository.source_root);
    match input.kind.as_str() {
        "local" => {
            let current = command_output(source, "git", &["branch", "--show-current"])
                .map_err(AppError::BadRequest)?;
            if current == branch {
                return Err(AppError::BadRequest(
                    "the current source branch cannot be deleted".into(),
                ));
            }
            command_output(source, "git", &["branch", "-d", branch])
                .map_err(AppError::BadRequest)?;
        }
        "remote" => {
            let remote = input
                .remote
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| AppError::BadRequest("remote is required".into()))?;
            if !git_remote_names(&repository.source_root)?
                .iter()
                .any(|candidate| candidate == remote)
            {
                return Err(AppError::BadRequest("remote was not found".into()));
            }
            command_output(source, "git", &["push", remote, "--delete", branch])
                .map_err(AppError::BadRequest)?;
        }
        _ => {
            return Err(AppError::BadRequest("kind must be local or remote".into()));
        }
    }
    Ok(Json(directory_branches(&repository.source_root)?))
}

#[derive(Deserialize)]
pub(super) struct CheckoutDirectoryBranch {
    kind: String,
    branch: String,
    remote: Option<String>,
}

pub(super) async fn checkout_directory_branch(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<CheckoutDirectoryBranch>,
) -> Result<Json<Directory>> {
    let repository = state.store.repository(&id)?;
    let project_id = repository.project_id.clone();
    let result = blocking_git_operation_for(repository.git_common_dir, move || {
        checkout_directory_branch_impl(state, id, input)
    })
    .await?;
    project_worktrees_cache().invalidate(&project_id).await;
    Ok(result)
}

pub(super) fn checkout_directory_branch_impl(
    state: AppState,
    id: String,
    input: CheckoutDirectoryBranch,
) -> Result<Json<Directory>> {
    let mut directory = state.store.repository_as_directory(&id)?;
    ensure_active_project(&state.store.project(&directory.project_id)?)?;
    ensure_git_directory(&directory)?;
    let branches = directory_branches(&directory.path)?;
    match input.kind.as_str() {
        "local" => {
            if !branches.local.contains(&input.branch) {
                return Err(AppError::BadRequest("local branch was not found".into()));
            }
            command_output(
                Path::new(&directory.path),
                "git",
                &["switch", &input.branch],
            )
            .map_err(AppError::BadRequest)?;
        }
        "remote" => {
            let remote = input
                .remote
                .as_deref()
                .ok_or_else(|| AppError::BadRequest("remote is required".into()))?;
            let remote_branches = branches
                .remotes
                .iter()
                .find(|item| item.name == remote)
                .ok_or_else(|| AppError::BadRequest("remote was not found".into()))?;
            if !remote_branches.branches.contains(&input.branch) {
                return Err(AppError::BadRequest("remote branch was not found".into()));
            }
            if branches.local.contains(&input.branch) {
                command_output(
                    Path::new(&directory.path),
                    "git",
                    &["switch", &input.branch],
                )
                .map_err(AppError::BadRequest)?;
            } else {
                let remote_ref = format!("{remote}/{}", input.branch);
                command_output(
                    Path::new(&directory.path),
                    "git",
                    &["switch", "--track", "-c", &input.branch, &remote_ref],
                )
                .map_err(AppError::BadRequest)?;
            }
        }
        _ => {
            return Err(AppError::BadRequest("kind must be local or remote".into()));
        }
    }
    enrich_directory(&mut directory, None);
    Ok(Json(directory))
}

#[derive(Deserialize)]
pub(super) struct CreateWorkspace {
    pub(super) name: String,
    pub(super) description: Option<String>,
    pub(super) branch: Option<String>,
    pub(super) remote_name: Option<String>,
    pub(super) remote_branch: Option<String>,
}

#[derive(Clone)]
pub(super) struct WorkspaceWorktreePlan {
    pub(super) location: ProjectLocation,
    pub(super) workspace_location_id: String,
    pub(super) checkout_path: String,
    pub(super) branch: String,
    pub(super) start_ref: String,
    pub(super) setup_directory_id: String,
    pub(super) setup_workdir: String,
}

pub(super) struct WorkspaceWorktreeOutcome {
    plan: WorkspaceWorktreePlan,
    start_commit: Option<String>,
    error: Option<String>,
}

pub(super) struct WorkspaceSetupShell {
    workspace_location_id: String,
    project_location_id: String,
    location_name: String,
    command: String,
}

pub(super) struct CreatedWorkspace {
    pub(super) workspace: Workspace,
    pub(super) setup_shells: Vec<WorkspaceSetupShell>,
}

pub(super) async fn create_workspace(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    ApiJson(input): ApiJson<CreateWorkspace>,
) -> Result<(StatusCode, Json<Workspace>)> {
    let operation_state = state.clone();
    let cache_key = project_id.clone();
    let created =
        blocking_git_operation(move || create_workspace_impl(operation_state, project_id, input))
            .await?;
    project_worktrees_cache().invalidate(&cache_key).await;
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

pub(super) fn create_workspace_impl(
    state: AppState,
    project_id: String,
    input: CreateWorkspace,
) -> Result<CreatedWorkspace> {
    if input.name.trim().is_empty() {
        return Err(AppError::BadRequest("workspace name is required".into()));
    }
    let project = state.store.project(&project_id)?;
    if project.status != "active" {
        return Err(AppError::BadRequest(
            "cannot create a Workspace in an archived Project".into(),
        ));
    }
    let directories = state.store.project_directories(&project_id)?;
    let repositories = state.store.repositories(&project_id)?;
    let mut locations = repositories
        .iter()
        .map(|repository| state.store.repository_as_directory(&repository.id))
        .collect::<Result<Vec<_>>>()?;
    for location in &mut locations {
        refresh_location_observation(location)?;
    }
    let default_id = project
        .default_location_id
        .as_deref()
        .ok_or_else(|| AppError::BadRequest("Project has no default Git location".into()))?;
    let default_repository_id = directories
        .iter()
        .find(|directory| directory.id == default_id)
        .and_then(|directory| directory.repository_id.as_deref())
        .ok_or_else(|| AppError::BadRequest("default Directory has no Repository".into()))?;
    if !locations
        .iter()
        .any(|location| location.id == default_repository_id && location.git_status == "ready")
    {
        return Err(AppError::BadRequest(
            "default Project location is unavailable".into(),
        ));
    }
    if let Some(location) = locations
        .iter()
        .find(|location| location.git_common_dir.is_some() && location.git_status != "ready")
    {
        return Err(AppError::BadRequest(format!(
            "Git location '{}' is {}",
            location.name, location.git_status
        )));
    }
    let workspace_id = id();
    let explicit_branch = trimmed(input.branch).filter(|value| !value.is_empty());
    let branch = choose_shared_branch(&locations, explicit_branch.as_deref(), input.name.trim())?;
    let default_delivery_mode = locations
        .iter()
        .find(|location| location.id == default_repository_id)
        .and_then(|location| location.delivery_mode.clone())
        .unwrap_or_else(|| "remote_review".into());
    let timestamp = now();
    let mut snapshots = Vec::new();
    let mut plans = Vec::new();
    for location in &locations {
        let base_branch = location
            .base_branch
            .clone()
            .unwrap_or_else(|| project.default_base_branch.clone());
        let location_delivery_mode = location
            .delivery_mode
            .clone()
            .unwrap_or_else(|| "remote_review".into());
        let checkout_path =
            managed_worktree_path(&state.settings, &project.id, &location.id, &workspace_id)
                .to_string_lossy()
                .into_owned();
        let remote_name = if location.id == default_repository_id {
            trimmed(input.remote_name.clone())
                .filter(|v| !v.is_empty())
                .or_else(|| location.preferred_remote_name.clone())
        } else {
            location.preferred_remote_name.clone()
        };
        let remote_branch = if location.id == default_id {
            trimmed(input.remote_branch.clone()).filter(|v| !v.is_empty())
        } else {
            None
        };
        let mut snapshot = git_workspace_location(
            &workspace_id,
            location,
            &timestamp,
            checkout_path.clone(),
            branch.clone(),
            base_branch.clone(),
            String::new(),
            None,
            remote_name,
            remote_branch,
            location_delivery_mode,
        );
        snapshot.git_status = "creating".into();
        snapshot.start_commit = None;
        plans.push(WorkspaceWorktreePlan {
            location: location.clone(),
            workspace_location_id: snapshot.id.clone(),
            checkout_path,
            branch: branch.clone(),
            start_ref: base_branch.clone(),
            setup_directory_id: directories
                .iter()
                .find(|directory| directory.repository_id.as_deref() == Some(&location.id))
                .map(|directory| directory.id.clone())
                .unwrap_or_default(),
            setup_workdir: repositories
                .iter()
                .find(|repository| repository.id == location.id)
                .map(|repository| repository.setup_workdir.clone())
                .unwrap_or_else(|| ".".into()),
        });
        snapshots.push(snapshot);
    }
    let workspace = Workspace {
        id: workspace_id.clone(),
        project_id,
        name: input.name.trim().into(),
        description: trimmed(input.description).unwrap_or_default(),
        status: "active".into(),
        kind: "workspace".into(),
        parent_workspace_id: None,
        runtime_id: workspace_id.clone(),
        runtime_name: format!("treefold-{}", &workspace_id[..10]),
        created_at: timestamp.clone(),
        updated_at: timestamp,
        checkout_mode: "worktree".into(),
        project_directory_id: String::new(),
        worktree_id: None,
        checkout_path: String::new(),
        target_branch: String::new(),
        start_commit: String::new(),
        branch: branch.clone(),
        forked_from_commit: None,
        remote_name: None,
        remote_branch: None,
        branch_ownership: "managed".into(),
        delivery_mode: default_delivery_mode,
        delivery_status: "active".into(),
        close_outcome: None,
        integrated_commit: None,
        closed_at: None,
    };
    state
        .store
        .create_workspace_with_locations(&workspace, &snapshots)?;

    let outcomes = create_workspace_worktrees(plans);
    let setup_shells = record_workspace_worktree_outcomes(&state.store, outcomes)?;

    Ok(CreatedWorkspace {
        workspace: state.store.workspace(&workspace.id)?,
        setup_shells,
    })
}

pub(super) fn managed_repository_source_path(
    settings: &SettingsStore,
    project_id: &str,
    repository_id: &str,
) -> PathBuf {
    settings
        .treefold_home()
        .join("projects")
        .join(project_id)
        .join("repos")
        .join(repository_id)
        .join("source")
}

pub(super) fn managed_worktree_path(
    settings: &SettingsStore,
    project_id: &str,
    repository_id: &str,
    workspace_id: &str,
) -> PathBuf {
    settings
        .treefold_home()
        .join("projects")
        .join(project_id)
        .join("repos")
        .join(repository_id)
        .join("worktrees")
        .join(workspace_id)
}

pub(super) fn create_workspace_worktrees(
    plans: Vec<WorkspaceWorktreePlan>,
) -> Vec<WorkspaceWorktreeOutcome> {
    std::thread::scope(|scope| {
        let handles = plans
            .into_iter()
            .map(|plan| {
                let fallback = plan.clone();
                let handle = scope.spawn(move || create_workspace_worktree(plan));
                (fallback, handle)
            })
            .collect::<Vec<_>>();
        handles
            .into_iter()
            .map(|(fallback, handle)| {
                handle.join().unwrap_or_else(|_| WorkspaceWorktreeOutcome {
                    plan: fallback,
                    start_commit: None,
                    error: Some("worktree creation worker stopped unexpectedly".into()),
                })
            })
            .collect::<Vec<_>>()
    })
}

pub(super) fn create_workspace_worktree(plan: WorkspaceWorktreePlan) -> WorkspaceWorktreeOutcome {
    let result = (|| {
        let start_commit = command_output(
            Path::new(&plan.location.path),
            "git",
            &["rev-parse", "--verify", &plan.start_ref],
        )
        .map_err(|_| {
            format!(
                "base branch '{}' was not found in {}",
                plan.start_ref, plan.location.name
            )
        })?;
        if let Some(parent) = Path::new(&plan.checkout_path).parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("create worktree directory: {error}"))?;
        }
        command_output(
            Path::new(&plan.location.path),
            "git",
            &[
                "worktree",
                "add",
                "-b",
                &plan.branch,
                &plan.checkout_path,
                &plan.start_ref,
            ],
        )
        .map_err(|error| format!("create worktree for {}: {error}", plan.location.name))?;
        Ok::<_, String>(start_commit)
    })();

    match result {
        Ok(start_commit) => WorkspaceWorktreeOutcome {
            plan,
            start_commit: Some(start_commit),
            error: None,
        },
        Err(error) => WorkspaceWorktreeOutcome {
            plan,
            start_commit: None,
            error: Some(error),
        },
    }
}

pub(super) fn record_workspace_worktree_outcomes(
    store: &Store,
    outcomes: Vec<WorkspaceWorktreeOutcome>,
) -> Result<Vec<WorkspaceSetupShell>> {
    let mut setup_shells = Vec::new();
    for outcome in outcomes {
        if let Some(error) = outcome.error.as_deref() {
            store.set_workspace_location_creation_result(
                &outcome.plan.workspace_location_id,
                "failed",
                None,
                outcome.start_commit.as_deref(),
                Some(error),
            )?;
            continue;
        }
        store.set_workspace_location_creation_result(
            &outcome.plan.workspace_location_id,
            "ready",
            Some(&outcome.plan.checkout_path),
            outcome.start_commit.as_deref(),
            None,
        )?;
        let command = outcome.plan.location.worktree_setup_command.trim();
        if !command.is_empty() {
            let setup_path =
                Path::new(&outcome.plan.checkout_path).join(&outcome.plan.setup_workdir);
            let command = format!(
                "cd {} && {command}",
                shell_quote(&setup_path.to_string_lossy())
            );
            setup_shells.push(WorkspaceSetupShell {
                workspace_location_id: outcome.plan.workspace_location_id,
                project_location_id: outcome.plan.setup_directory_id,
                location_name: outcome.plan.location.name,
                command,
            });
        }
    }
    Ok(setup_shells)
}

pub(super) async fn start_workspace_setup_shells(
    state: &AppState,
    workspace: &Workspace,
    setup_shells: Vec<WorkspaceSetupShell>,
) {
    for setup in setup_shells {
        let result = create_session_for_workspace(
            state,
            workspace.clone(),
            CreateSession {
                name: Some(format!("setup · {}", setup.location_name)),
                kind: Some("shell".into()),
                project_directory_id: Some(setup.project_location_id),
                initial_prompt: Some(setup.command),
            },
        )
        .await;
        if let Err(error) = result {
            let message = format!("could not start setup shell: {error}");
            let _ = state
                .store
                .set_workspace_location_creation_error(&setup.workspace_location_id, &message);
            log::error!("{message}");
        }
    }
}

pub(super) fn spawn_workspace_setup_shells(
    state: AppState,
    workspace: Workspace,
    setup_shells: Vec<WorkspaceSetupShell>,
) {
    if setup_shells.is_empty() {
        return;
    }
    tokio::spawn(async move {
        start_workspace_setup_shells(&state, &workspace, setup_shells).await;
    });
}

pub(super) async fn get_workspace(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<WorkspaceDetail>> {
    let mut detail = state.store.workspace_detail(&id)?;
    for location in &mut detail.repositories {
        if detail.workspace.status != "active" {
            continue;
        }
        if location.access_mode == "read_only" {
            location.git_status = if Path::new(&location.source_path).is_dir() {
                "not_git"
            } else {
                "missing"
            }
            .into();
        } else if let Some(path) = location.checkout_path.as_deref() {
            location.git_status = if !Path::new(path).is_dir() {
                "missing"
            } else if command_output(
                Path::new(path),
                "git",
                &["rev-parse", "--is-inside-work-tree"],
            )
            .is_err()
            {
                "broken"
            } else {
                "ready"
            }
            .into();
        }
    }
    detail.sessions = refresh_session_records(&state, detail.sessions).await?;
    Ok(Json(detail))
}

#[derive(Deserialize)]
pub(super) struct UpdateWorkspace {
    name: String,
    description: String,
}

pub(super) async fn update_workspace(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<UpdateWorkspace>,
) -> Result<Json<Workspace>> {
    ensure_active_workspace(&state.store.workspace(&id)?)?;
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest(
            "Workspace name cannot be empty".into(),
        ));
    }
    state
        .store
        .rename_workspace(&id, name, &input.description)?;
    Ok(Json(state.store.workspace(&id)?))
}

pub(super) async fn delete_workspace(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<StatusCode> {
    let workspace = state.store.workspace(&id)?;
    if workspace.kind == "base" || workspace.status != "archived" {
        return Err(AppError::BadRequest(
            "Finish the Workspace or Fork before permanently deleting it".into(),
        ));
    }
    if !state.store.forks(&id)?.is_empty() {
        return Err(AppError::BadRequest(
            "Delete this Workspace's Forks before deleting the Workspace".into(),
        ));
    }
    for session in state.store.sessions(&id)? {
        if state
            .terminals
            .inspect_existing(&session.amux_workspace_name, &session.amux_process_name)
            .await?
            .is_some_and(|process| {
                matches!(
                    process.state,
                    amux::model::ProcessState::Created
                        | amux::model::ProcessState::Starting
                        | amux::model::ProcessState::Running
                        | amux::model::ProcessState::Stopping
                )
            })
        {
            return Err(AppError::BadRequest(
                "Close all running Sessions before deleting this Workspace".into(),
            ));
        }
    }
    state.store.delete_workspace(&id)?;
    Ok(StatusCode::NO_CONTENT)
}

pub(super) fn ensure_active_project(project: &Project) -> Result<()> {
    if project.status != "active" {
        return Err(AppError::BadRequest(
            "Archived Projects are read-only".into(),
        ));
    }
    Ok(())
}

#[derive(Deserialize)]
pub(super) struct UpdateWorkspaceLocation {
    pub(super) remote_name: Option<String>,
    pub(super) remote_branch: Option<String>,
}

pub(super) async fn update_workspace_location(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<UpdateWorkspaceLocation>,
) -> Result<Json<WorkspaceLocation>> {
    let location = state.store.workspace_location(&id)?;
    let workspace = state.store.workspace(&location.workspace_id)?;
    ensure_active_workspace(&workspace)?;
    if workspace.kind != "workspace" {
        return Err(AppError::BadRequest(
            "remote upstream settings are available only for a root Workspace".into(),
        ));
    }
    let path = workspace_location_git_path(&location)?;
    let remote_name = trimmed(input.remote_name).filter(|value| !value.is_empty());
    let remote_branch = trimmed(input.remote_branch).filter(|value| !value.is_empty());
    if remote_name.is_some() != remote_branch.is_some() {
        return Err(AppError::BadRequest(
            "remote_name and remote_branch must both be set or both be empty".into(),
        ));
    }
    if let Some(remote) = remote_name.as_deref() {
        let remotes = git_remote_names(path)?;
        if !remotes.iter().any(|candidate| candidate == remote) {
            return Err(AppError::BadRequest(
                "Workspace location remote was not found".into(),
            ));
        }
    }
    state.store.update_workspace_delivery(
        &id,
        remote_name.as_deref(),
        remote_branch.as_deref(),
        &location.delivery_mode,
    )?;
    Ok(Json(state.store.workspace_location(&id)?))
}
