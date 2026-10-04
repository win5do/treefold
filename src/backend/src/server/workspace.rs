use super::*;

pub(super) async fn list_projects(State(state): State<AppState>) -> Result<Json<Vec<Project>>> {
    Ok(Json(state.store.projects().await?))
}

pub(super) async fn list_project_summaries(
    State(state): State<AppState>,
) -> Result<Json<Vec<ProjectSummary>>> {
    Ok(Json(state.store.project_summaries_async().await?))
}

pub(super) async fn get_sidebar(State(state): State<AppState>) -> Result<Json<SidebarData>> {
    Ok(Json(state.store.sidebar_async().await?))
}

#[derive(Deserialize)]
pub(super) struct CreateProject {
    pub(super) name: Option<String>,
    pub(super) description: Option<String>,
    pub(super) path: Option<String>,
    pub(super) locations: Option<Vec<String>>,
    pub(super) preferred_remote: Option<String>,
    pub(super) directory_description: Option<String>,
    pub(super) directory_worktree_setup_command: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct InspectProjectPath {
    path: String,
}

#[derive(Serialize)]
pub(super) struct ProjectPathCandidate {
    pub(super) path: String,
    pub(super) repository_root: Option<String>,
    pub(super) is_git: bool,
}

#[derive(Serialize)]
pub(super) struct ProjectPathInspection {
    pub(super) path: String,
    pub(super) candidates: Vec<ProjectPathCandidate>,
}

pub(super) fn inspect_project_path_value(value: &str) -> Result<ProjectPathInspection> {
    let (path, is_git) = inspect_path(value)?;
    let mut candidates = Vec::new();
    if is_git {
        let root = command_output(Path::new(&path), "git", &["rev-parse", "--show-toplevel"])
            .map_err(AppError::BadRequest)?;
        candidates.push(ProjectPathCandidate {
            path: path.clone(),
            repository_root: Some(root),
            is_git: true,
        });
    } else {
        let mut children = std::fs::read_dir(&path)
            .map_err(|error| AppError::BadRequest(format!("cannot read directory: {error}")))?
            .filter_map(std::result::Result::ok)
            .filter_map(|entry| {
                let path = entry.path();
                // Follow directory symlinks; broken links and file targets are not candidates.
                path.is_dir().then_some(path)
            })
            .collect::<Vec<_>>();
        children.sort();
        let mut seen = HashSet::new();
        for child in children {
            let child = child.to_string_lossy().into_owned();
            let (child, child_is_git) = inspect_path(&child)?;
            if !seen.insert(child.clone()) {
                continue;
            }
            let repository_root = if child_is_git {
                Some(
                    command_output(Path::new(&child), "git", &["rev-parse", "--show-toplevel"])
                        .map_err(AppError::BadRequest)?,
                )
            } else {
                None
            };
            candidates.push(ProjectPathCandidate {
                path: child,
                repository_root,
                is_git: child_is_git,
            });
        }
    }
    Ok(ProjectPathInspection { path, candidates })
}

pub(super) async fn inspect_project_path(
    ApiJson(input): ApiJson<InspectProjectPath>,
) -> Result<Json<ProjectPathInspection>> {
    Ok(Json(inspect_project_path_value(&input.path)?))
}
pub(super) async fn create_project(
    State(state): State<AppState>,
    ApiJson(input): ApiJson<CreateProject>,
) -> Result<(StatusCode, Json<Project>)> {
    let locations = input
        .locations
        .as_ref()
        .map(|paths| {
            if paths.is_empty() {
                return Err(AppError::BadRequest(
                    "at least one location is required".into(),
                ));
            }
            let mut seen = HashSet::new();
            let mut inspected = Vec::new();
            for value in paths {
                let (path, is_git) = inspect_path(value)?;
                if !seen.insert(path.clone()) {
                    return Err(AppError::BadRequest("duplicate location path".into()));
                }
                inspected.push((path, is_git));
            }
            if !inspected.iter().any(|(_, git)| *git) {
                return Err(AppError::BadRequest(
                    "a Project needs a Git repository".into(),
                ));
            }
            inspected.sort_by_key(|(_, git)| !*git);
            Ok(inspected)
        })
        .transpose()?;
    let timestamp = now();
    let project_id = new_id();
    let name = trimmed(input.name)
        .filter(|v| !v.is_empty())
        .or_else(|| input.path.as_deref().map(basename))
        .ok_or_else(|| AppError::BadRequest("name is required".into()))?;
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
        created_at: timestamp.clone(),
        updated_at: timestamp.clone(),
        primary_directory_id: String::new(),
        git_common_dir: String::new(),
        preferred_remote: None,
    };
    state.store.create_empty_project(&project).await?;
    if let Some(locations) = locations {
        for (path, is_git) in locations {
            let mut location = Directory {
                id: new_id(),
                project_id: project_id.clone(),
                name: basename(&path),
                description: String::new(),
                worktree_setup_command: String::new(),
                path,
                repository_url: None,
                preferred_remote_name: None,
                git_common_dir: None,
                git_status: if is_git { "ready" } else { "not_git" }.into(),
                last_checked_at: None,
                created_at: timestamp.clone(),
                updated_at: timestamp.clone(),
                checkout_path: None,
                role: "attached".into(),
                is_git,
                remote_url: None,
                branch: None,
                head_commit: None,
                head_summary: None,
                dirty: false,
            };
            if let Err(error) = refresh_location_observation(&mut location).and_then(|_| {
                if (is_git && location.git_status == "ready")
                    || (!is_git && location.git_status == "not_git")
                {
                    Ok(())
                } else {
                    Err(AppError::BadRequest(
                        "location changed during Project creation".into(),
                    ))
                }
            }) {
                let _ = state.store.delete_project(&project_id).await;
                return Err(error);
            }
            if let Err(error) = state.store.create_directory(&location).await {
                let _ = state.store.delete_project(&project_id).await;
                return Err(error);
            }
        }
        return Ok((
            StatusCode::CREATED,
            Json(state.store.project(&project_id).await?),
        ));
    }
    if let Some((path, is_git)) = inspected_path {
        let mut location = Directory {
            id: new_id(),
            project_id: project_id.clone(),
            name: basename(&path),
            description: trimmed(input.directory_description).unwrap_or_default(),
            worktree_setup_command: trimmed(input.directory_worktree_setup_command)
                .unwrap_or_default(),
            path,
            repository_url: None,
            preferred_remote_name: trimmed(input.preferred_remote).filter(|v| !v.is_empty()),
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
        state.store.create_directory(&location).await?;
    }
    Ok((
        StatusCode::CREATED,
        Json(state.store.project(&project_id).await?),
    ))
}

#[derive(Deserialize)]
pub(super) struct UpdateProject {
    pub(super) name: Option<String>,
    pub(super) description: Option<String>,
    pub(super) status: Option<String>,
    #[serde(rename = "default_directory_id", alias = "default_location_id")]
    pub(super) default_location_id: Option<String>,
}

pub(super) async fn update_project(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<UpdateProject>,
) -> Result<Json<Project>> {
    let current = state.store.project(&id).await?;
    if current.status == "archived" {
        let restoring = input.status.as_deref() == Some("active")
            && input.name.is_none()
            && input.description.is_none()
            && input.default_location_id.is_none();
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
        let mut location = state.store.directory(default_id).await?;
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
        state.store.rename_project(&id, name, description).await?;
    }
    if status == "archived" && current.status != "archived" {
        let active = state
            .store
            .workspaces(&id)
            .await?
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
        for workspace in state.store.workspaces(&id).await? {
            for mut session in state.store.sessions(&workspace.id).await? {
                capture_agent_session_id(&state, &mut session).await?;
                let _ = state
                    .terminals
                    .stop_existing(&session.amux_workspace_name, &session.amux_process_name)
                    .await;
                state
                    .store
                    .set_session_status(&session.id, "stopped")
                    .await?;
            }
        }
        super::session_titles::capture(&state, true).await?;
    }
    if input.status.is_some() {
        state.store.update_project_status(&id, status).await?;
    }
    if input.default_location_id.is_some() {
        let default_id = input
            .default_location_id
            .as_deref()
            .or(current.default_location_id.as_deref());
        state.store.update_project_defaults(&id, default_id).await?;
    }
    if status == "archived" && current.status != "archived" {
        state.runtime.publish_sessions();
    }
    Ok(Json(state.store.project(&id).await?))
}

pub(super) async fn get_project(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<ProjectDetail>> {
    let mut detail = state.store.project_detail(&id).await?;
    let tracked_workspaces = state.store.workspaces(&id).await?;
    let mut tracked_workspace_repositories = Vec::new();
    for workspace in &tracked_workspaces {
        tracked_workspace_repositories
            .extend(state.store.workspace_repositories(&workspace.id).await?);
    }
    let mut squash_operations = Vec::new();
    for repository in &tracked_workspace_repositories {
        if let Some(operation) = state
            .store
            .latest_parent_operation(&repository.id, "integrate")
            .await?
            && operation.strategy == "squash"
            && operation.status == "completed"
        {
            squash_operations.push(operation);
        }
    }
    let mut locations = Vec::new();
    for repository in state.store.repositories(&id).await? {
        locations.push(state.store.repository_as_directory(&repository.id).await?);
    }
    detail.worktrees = blocking_git_operation(move || async move {
        Ok(project_worktrees(
            &locations,
            &tracked_workspaces,
            &tracked_workspace_repositories,
            &squash_operations,
        ))
    })
    .await?;
    detail.sessions = refresh_session_records(&state, detail.sessions).await?;
    Ok(Json(detail))
}

pub(super) async fn reveal_project(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<StatusCode> {
    let project = state.store.project(&id).await?;
    let directory = state.store.directory(&project.primary_directory_id).await?;
    reveal_in_file_manager(&directory.path)?;
    Ok(StatusCode::NO_CONTENT)
}

pub(super) async fn reveal_workspace(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<StatusCode> {
    let workspace = state.store.workspace(&id).await?;
    reveal_in_file_manager(&workspace.checkout_path)?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub(super) struct DeleteWorktree {
    path: String,
}

#[derive(Serialize)]
pub(super) struct DeleteWorktreePrecheck {
    status: &'static str,
    directory_exists: bool,
    tracked_changes: usize,
    untracked_files: usize,
    blockers: Vec<String>,
    warnings: Vec<String>,
}

#[derive(Clone, Serialize)]
pub(super) struct DeleteWorktreeOperation {
    id: String,
    repository_id: String,
    path: String,
    status: String,
    error: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct DeleteWorktreeStatusQuery {
    path: String,
}

static WORKTREE_DELETE_OPERATIONS: OnceLock<Cache<String, DeleteWorktreeOperation>> =
    OnceLock::new();

fn worktree_delete_operations() -> &'static Cache<String, DeleteWorktreeOperation> {
    WORKTREE_DELETE_OPERATIONS.get_or_init(|| {
        Cache::builder()
            .max_capacity(256)
            .time_to_live(std::time::Duration::from_secs(30 * 60))
            .build()
    })
}

fn worktree_delete_key(repository_id: &str, path: &str) -> String {
    format!(
        "{repository_id}:{}",
        normalized_path(path).to_string_lossy()
    )
}

struct DeleteWorktreeInspection {
    project_id: String,
    repository_path: String,
    worktree_path: String,
    precheck: DeleteWorktreePrecheck,
}

pub(super) async fn precheck_delete_worktree(
    State(state): State<AppState>,
    AxumPath(repository_id): AxumPath<String>,
    ApiJson(input): ApiJson<DeleteWorktree>,
) -> Result<Json<DeleteWorktreePrecheck>> {
    blocking_git_operation(move || async move {
        inspect_delete_worktree(&state, &repository_id, &input.path)
            .await
            .map(|inspection| Json(inspection.precheck))
    })
    .await
}

pub(super) async fn delete_worktree(
    State(state): State<AppState>,
    AxumPath(repository_id): AxumPath<String>,
    ApiJson(input): ApiJson<DeleteWorktree>,
) -> Result<(StatusCode, Json<DeleteWorktreeOperation>)> {
    let key = worktree_delete_key(&repository_id, &input.path);
    if let Some(operation) = worktree_delete_operations().get(&key).await {
        if operation.status == "deleting" {
            return Ok((StatusCode::ACCEPTED, Json(operation)));
        }
    }

    let operation = DeleteWorktreeOperation {
        id: new_id(),
        repository_id: repository_id.clone(),
        path: input.path.clone(),
        status: "deleting".into(),
        error: None,
    };
    worktree_delete_operations()
        .insert(key.clone(), operation.clone())
        .await;
    let operation_id = operation.id.clone();
    let operation_repository_id = operation.repository_id.clone();
    let operation_path = operation.path.clone();
    crate::request_context::spawn(async move {
        let result = async {
            let repository = state.store.repository(&repository_id).await?;
            blocking_git_operation_for(repository.git_common_dir, move || async move {
                let inspection =
                    inspect_delete_worktree(&state, &repository_id, &input.path).await?;
                if let Some(blocker) = inspection.precheck.blockers.first() {
                    return Err(AppError::BadRequest(blocker.clone()));
                }
                let DeleteWorktreeInspection {
                    project_id,
                    repository_path,
                    worktree_path,
                    ..
                } = inspection;
                command_output(
                    Path::new(&repository_path),
                    "git",
                    &["worktree", "remove", &worktree_path],
                )
                .map_err(AppError::BadRequest)?;
                Ok(project_id)
            })
            .await
        }
        .await;
        match result {
            Ok(_project_id) => {
                worktree_delete_operations()
                    .insert(
                        key,
                        DeleteWorktreeOperation {
                            id: operation_id,
                            repository_id: operation_repository_id,
                            path: operation_path,
                            status: "completed".into(),
                            error: None,
                        },
                    )
                    .await;
            }
            Err(error) => {
                worktree_delete_operations()
                    .insert(
                        key,
                        DeleteWorktreeOperation {
                            id: operation_id,
                            repository_id: operation_repository_id,
                            path: operation_path,
                            status: "failed".into(),
                            error: Some(error.to_string()),
                        },
                    )
                    .await;
            }
        }
    });
    Ok((StatusCode::ACCEPTED, Json(operation)))
}

pub(super) async fn delete_worktree_status(
    AxumPath(repository_id): AxumPath<String>,
    Query(query): Query<DeleteWorktreeStatusQuery>,
) -> Result<Json<DeleteWorktreeOperation>> {
    worktree_delete_operations()
        .get(&worktree_delete_key(&repository_id, &query.path))
        .await
        .map(Json)
        .ok_or(AppError::NotFound)
}

async fn inspect_delete_worktree(
    state: &AppState,
    repository_id: &str,
    worktree_path: &str,
) -> Result<DeleteWorktreeInspection> {
    let directory = state.store.repository_as_directory(repository_id).await?;
    ensure_active_project(&state.store.project(&directory.project_id).await?)?;
    if !directory.is_git {
        return Err(AppError::BadRequest(
            "directory is not a Git repository".into(),
        ));
    }

    let target = normalized_path(worktree_path);
    let mut blockers = Vec::new();
    let mut warnings = Vec::new();
    let project_directories = state.store.directories(&directory.project_id).await?;
    if project_directories
        .iter()
        .any(|item| normalized_path(&item.path) == target)
    {
        blockers.push("a Project directory cannot be removed as a worktree".into());
    }
    let listed = git_worktrees(&directory.path)?;
    let Some(listed_worktree) = listed
        .iter()
        .find(|item| normalized_path(&item.path) == target)
    else {
        return Ok(DeleteWorktreeInspection {
            project_id: directory.project_id,
            repository_path: directory.path,
            worktree_path: worktree_path.to_owned(),
            precheck: DeleteWorktreePrecheck {
                status: "blocked",
                directory_exists: Path::new(worktree_path).exists(),
                tracked_changes: 0,
                untracked_files: 0,
                blockers: vec!["worktree does not belong to this Git repository".into()],
                warnings,
            },
        });
    };
    if listed_worktree.is_main {
        blockers.push("the repository's main worktree cannot be removed".into());
    }

    if let Some(workspace) = state
        .store
        .workspaces(&directory.project_id)
        .await?
        .into_iter()
        .find(|item| item.status == "active" && normalized_path(&item.checkout_path) == target)
    {
        blockers.push(format!(
            "worktree belongs to active Workspace '{}'; use Finish Workspace",
            workspace.name
        ));
    }

    let directory_exists = Path::new(worktree_path).exists();
    let (tracked_changes, untracked_files) = if directory_exists {
        let tracked = command_output(
            Path::new(worktree_path),
            "git",
            &["status", "--porcelain=v1", "--untracked-files=no"],
        )
        .map_err(|error| AppError::BadRequest(format!("check worktree changes: {error}")))?;
        let untracked = command_output(
            Path::new(worktree_path),
            "git",
            &["ls-files", "--others", "--exclude-standard"],
        )
        .map_err(|error| AppError::BadRequest(format!("check untracked files: {error}")))?;
        let tracked_changes = tracked.lines().filter(|line| !line.is_empty()).count();
        let untracked_files = untracked.lines().filter(|line| !line.is_empty()).count();
        if tracked_changes > 0 {
            blockers.push(
                "worktree has uncommitted tracked changes; commit or stash them before deleting it"
                    .into(),
            );
        } else if untracked_files > 0 {
            blockers.push(
                "worktree has uncommitted changes; commit, stash, or discard them before deleting it"
                    .into(),
            );
        }
        (tracked_changes, untracked_files)
    } else {
        warnings.push(
            "The worktree directory is missing. Treefold will remove only its stale Git registration."
                .into(),
        );
        (0, 0)
    };

    let status = if blockers.is_empty() {
        if directory_exists { "ready" } else { "stale" }
    } else {
        "blocked"
    };
    Ok(DeleteWorktreeInspection {
        project_id: directory.project_id,
        repository_path: directory.path,
        worktree_path: worktree_path.to_owned(),
        precheck: DeleteWorktreePrecheck {
            status,
            directory_exists,
            tracked_changes,
            untracked_files,
            blockers,
            warnings,
        },
    })
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct ProjectDeleteResource {
    path: String,
    repository_name: String,
    project_repository_id: String,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct ProjectDeletePrecheck {
    status: String,
    managed_sources: Vec<ProjectDeleteResource>,
    managed_worktrees: Vec<ProjectDeleteResource>,
    blockers: Vec<String>,
    warnings: Vec<String>,
}

#[derive(Deserialize)]
pub(super) struct DeleteProject {
    #[serde(default)]
    pub(super) cleanup_managed: bool,
}

pub(super) async fn precheck_delete_project(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<ProjectDeletePrecheck>> {
    blocking_git_operation(
        move || async move { inspect_project_deletion(&state, &id).await.map(Json) },
    )
    .await
}

pub(super) async fn delete_project(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    Query(input): Query<DeleteProject>,
) -> Result<StatusCode> {
    if state.store.project(&id).await?.status != "archived" {
        return Err(AppError::BadRequest(
            "Archive the Project before permanently deleting it".into(),
        ));
    }
    if state
        .store
        .workspaces(&id)
        .await?
        .iter()
        .any(|workspace| workspace.kind != "base" && workspace.status == "active")
    {
        return Err(AppError::BadRequest(
            "Finish active Workspaces and Forks before deleting this Project".into(),
        ));
    }
    if input.cleanup_managed {
        let cleanup_state = state.clone();
        let cleanup_id = id.clone();
        blocking_git_operation(move || async move {
            cleanup_project_managed_paths(&cleanup_state, &cleanup_id).await
        })
        .await?;
    }
    state.store.delete_project(&id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn inspect_project_deletion(
    state: &AppState,
    project_id: &str,
) -> Result<ProjectDeletePrecheck> {
    let project = state.store.project(project_id).await?;
    let repositories = state.store.repositories(project_id).await?;
    let workspaces = state.store.workspaces(project_id).await?;
    let mut blockers = Vec::new();
    let mut warnings = Vec::new();

    if project.status != "archived" {
        blockers.push("Archive the Project before permanently deleting it".into());
    }
    for workspace in &workspaces {
        if workspace.kind != "base" && workspace.status == "active" {
            blockers.push(format!(
                "Finish active {} '{}' before deleting this Project",
                workspace.kind, workspace.name
            ));
        }
    }

    let managed_source_root = state
        .settings
        .treefold_home()
        .join("git")
        .join("s")
        .join(slug(project_id));
    let managed_worktree_root = state.settings.treefold_home().join("git").join("w");
    let mut managed_sources = Vec::new();
    for repository in &repositories {
        if repository.source_ownership != "managed" {
            continue;
        }
        let source = Path::new(&repository.source_root);
        if !normalized_path(source.to_string_lossy().as_ref()).starts_with(normalized_path(
            managed_source_root.to_string_lossy().as_ref(),
        )) {
            blockers.push(format!(
                "managed source is outside Treefold's Project source root: {}",
                repository.source_root
            ));
            continue;
        }
        managed_sources.push(ProjectDeleteResource {
            path: repository.source_root.clone(),
            repository_name: repository.name.clone(),
            project_repository_id: repository.id.clone(),
        });
        if !source.exists() {
            warnings.push(format!(
                "managed source is already missing: {}",
                repository.source_root
            ));
            continue;
        }
        let (tracked, untracked) = worktree_change_counts(source)?;
        if tracked + untracked > 0 {
            blockers.push(format!(
                "managed source '{}' has {tracked} tracked changes and {untracked} untracked files",
                repository.name
            ));
        }
        let unpublished = command_output(
            source,
            "git",
            &["rev-list", "--count", "--branches", "--not", "--remotes"],
        )
        .map_err(|error| {
            AppError::BadRequest(format!(
                "check unpublished commits in managed source '{}': {error}",
                repository.name
            ))
        })?
        .parse::<usize>()
        .unwrap_or(0);
        if unpublished > 0 {
            blockers.push(format!(
                "managed source '{}' has {unpublished} commits not reachable from a remote",
                repository.name
            ));
        }
    }

    let repository_by_id = repositories
        .iter()
        .map(|repository| (repository.id.as_str(), repository))
        .collect::<std::collections::HashMap<_, _>>();
    let mut seen_worktrees = std::collections::HashSet::new();
    let mut managed_worktrees = Vec::new();
    for workspace in &workspaces {
        for snapshot in state.store.workspace_repositories(&workspace.id).await? {
            let Some(checkout_path) = snapshot.checkout_path.as_deref() else {
                continue;
            };
            if !seen_worktrees.insert(checkout_path.to_owned()) {
                continue;
            }
            if snapshot.worktree_ownership != "managed"
                || !normalized_path(checkout_path).starts_with(normalized_path(
                    managed_worktree_root.to_string_lossy().as_ref(),
                ))
            {
                warnings.push(format!(
                    "checkout is externally owned or outside Treefold's managed worktree root and will be preserved: {checkout_path}"
                ));
                continue;
            }
            managed_worktrees.push(ProjectDeleteResource {
                path: checkout_path.to_owned(),
                repository_name: snapshot.repository_name.clone(),
                project_repository_id: snapshot.project_repository_id.clone(),
            });
            let checkout = Path::new(checkout_path);
            if !checkout.exists() {
                warnings.push(format!(
                    "managed worktree is already missing: {checkout_path}"
                ));
                continue;
            }
            let Some(repository) = repository_by_id.get(snapshot.project_repository_id.as_str())
            else {
                blockers.push(format!(
                    "managed worktree has no Project repository: {checkout_path}"
                ));
                continue;
            };
            let registered = git_worktrees(&repository.source_root)?
                .iter()
                .any(|worktree| normalized_path(&worktree.path) == normalized_path(checkout_path));
            if !registered {
                blockers.push(format!(
                    "managed worktree is no longer registered with its source repository: {checkout_path}"
                ));
                continue;
            }
            let (tracked, untracked) = worktree_change_counts(checkout)?;
            if tracked + untracked > 0 {
                blockers.push(format!(
                    "managed worktree '{}' has {tracked} tracked changes and {untracked} untracked files",
                    workspace.name
                ));
            }
        }
    }

    Ok(ProjectDeletePrecheck {
        status: if blockers.is_empty() {
            "ready".into()
        } else {
            "blocked".into()
        },
        managed_sources,
        managed_worktrees,
        blockers,
        warnings,
    })
}

fn worktree_change_counts(path: &Path) -> Result<(usize, usize)> {
    let tracked = command_output(
        path,
        "git",
        &["status", "--porcelain=v1", "--untracked-files=no"],
    )
    .map_err(|error| AppError::BadRequest(format!("check tracked changes: {error}")))?;
    let untracked = command_output(path, "git", &["ls-files", "--others", "--exclude-standard"])
        .map_err(|error| AppError::BadRequest(format!("check untracked files: {error}")))?;
    Ok((
        tracked.lines().filter(|line| !line.is_empty()).count(),
        untracked.lines().filter(|line| !line.is_empty()).count(),
    ))
}

async fn cleanup_project_managed_paths(state: &AppState, project_id: &str) -> Result<()> {
    let precheck = inspect_project_deletion(state, project_id).await?;
    if !precheck.blockers.is_empty() {
        return Err(AppError::BadRequest(precheck.blockers.join("; ")));
    }
    let repositories = state.store.repositories(project_id).await?;
    let repository_by_id = repositories
        .iter()
        .map(|repository| (repository.id.as_str(), repository))
        .collect::<std::collections::HashMap<_, _>>();
    for worktree in &precheck.managed_worktrees {
        let Some(repository) = repository_by_id.get(worktree.project_repository_id.as_str()) else {
            return Err(AppError::BadRequest(format!(
                "managed worktree has no Project repository: {}",
                worktree.path
            )));
        };
        remove_worktree_if_present(&repository.source_root, &worktree.path, false)?;
    }
    for source in &precheck.managed_sources {
        let path = Path::new(&source.path);
        if path.exists() {
            std::fs::remove_dir_all(path).map_err(|error| {
                AppError::BadRequest(format!("remove managed source '{}': {error}", source.path))
            })?;
        }
    }
    let project_source_root = state
        .settings
        .treefold_home()
        .join("git")
        .join("s")
        .join(slug(project_id));
    if project_source_root.exists() {
        let _ = std::fs::remove_dir(project_source_root);
    }
    Ok(())
}

#[derive(Deserialize)]
pub(super) struct CreateDirectory {
    pub(super) description: Option<String>,
    pub(super) worktree_setup_command: Option<String>,
    pub(super) path: String,
}

#[derive(Deserialize)]
pub(super) struct InspectProjectDirectory {
    path: String,
    project_id: Option<String>,
}

#[derive(Serialize)]
pub(super) struct ProjectDirectoryInspection {
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
}

pub(super) async fn inspect_project_directory(
    State(state): State<AppState>,
    ApiJson(input): ApiJson<InspectProjectDirectory>,
) -> Result<Json<ProjectDirectoryInspection>> {
    let (path, is_git) = inspect_path(&input.path)?;
    let mut location = Directory {
        id: String::new(),
        project_id: String::new(),
        name: basename(&path),
        description: String::new(),
        worktree_setup_command: String::new(),
        path,
        repository_url: None,
        preferred_remote_name: None,
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
    let repository_id = if let (Some(project_id), Some(common)) = (
        input.project_id.as_deref(),
        location.git_common_dir.as_deref(),
    ) {
        state
            .store
            .repositories(project_id)
            .await
            .ok()
            .and_then(|repositories| {
                repositories
                    .into_iter()
                    .find(|repository| repository.git_common_dir == common)
                    .map(|repository| repository.id)
            })
    } else {
        None
    };
    Ok(Json(ProjectDirectoryInspection {
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
    }))
}

pub(super) async fn list_project_directories(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
) -> Result<Json<Vec<ProjectDirectory>>> {
    state.store.project(&project_id).await?;
    Ok(Json(state.store.project_directories(&project_id).await?))
}

pub(super) async fn get_project_directory(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<ProjectDirectory>> {
    Ok(Json(state.store.directory_record(&id).await?))
}

#[derive(Deserialize)]
pub(super) struct CloneProjectRepository {
    pub(super) url: String,
    pub(super) name: Option<String>,
    pub(super) preferred_remote_name: Option<String>,
    pub(super) setup_command: Option<String>,
}

pub(super) async fn clone_project_repository(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    ApiJson(input): ApiJson<CloneProjectRepository>,
) -> Result<(StatusCode, Json<Directory>)> {
    let result = blocking_git_operation(move || async move {
        clone_project_repository_impl(state, project_id, input).await
    })
    .await?;
    Ok(result)
}

pub(super) async fn clone_project_repository_impl(
    state: AppState,
    project_id: String,
    input: CloneProjectRepository,
) -> Result<(StatusCode, Json<Directory>)> {
    let project = state.store.project(&project_id).await?;
    ensure_active_project(&project)?;
    let url = input.url.trim();
    if url.is_empty() {
        return Err(AppError::BadRequest("Git URL is required".into()));
    }
    let repository_id = new_id();
    let repository_name = input
        .name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| repository_name_from_url(url));
    let source = managed_repository_source_path(&state.settings, &project_id, &repository_name);
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
        id: new_id(),
        project_id: project_id.clone(),
        name: repository_name,
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
        .create_directory_with_repository_id(&directory, Some(&repository_id), "managed")
        .await
    {
        Ok(id) => id,
        Err(error) => {
            let _ = std::fs::remove_dir_all(parent);
            return Err(error);
        }
    };
    let directory = state.store.directory(&directory_id).await?;
    Ok((StatusCode::CREATED, Json(directory)))
}

pub(super) async fn get_project_repository(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<ProjectRepository>> {
    Ok(Json(state.store.repository(&id).await?))
}
pub(super) async fn create_directory(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    ApiJson(input): ApiJson<CreateDirectory>,
) -> Result<(StatusCode, Json<Directory>)> {
    let project = state.store.project(&project_id).await?;
    ensure_active_project(&project)?;
    let (path, is_git) = inspect_path(&input.path)?;
    if project.default_location_id.is_none() && !is_git {
        return Err(AppError::BadRequest(
            "a Project's first location must be a ready Git repository".into(),
        ));
    }
    let name = basename(&path);
    let directory = Directory {
        id: new_id(),
        project_id,
        name,
        description: trimmed(input.description).unwrap_or_default(),
        worktree_setup_command: trimmed(input.worktree_setup_command).unwrap_or_default(),
        path,
        repository_url: None,
        preferred_remote_name: None,
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
    let directory_id = state.store.create_directory(&directory).await?;
    let directory = state.store.directory(&directory_id).await?;
    Ok((StatusCode::CREATED, Json(directory)))
}

pub(super) async fn refresh_project_directory(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Directory>> {
    let mut location = state.store.directory(&id).await?;
    ensure_active_project(&state.store.project(&location.project_id).await?)?;
    let was_git = location.git_common_dir.is_some();
    refresh_location_observation(&mut location)?;
    if location.git_status != "ready" && was_git {
        // Persisted repository identity is intentionally retained when the path
        // is unavailable or no longer points at the same repository.
        location.is_git = false;
    }
    location.updated_at = now();
    state.store.refresh_project_directory(&location).await?;
    Ok(Json(location))
}

pub(super) async fn refresh_project_repository(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<ProjectRepository>> {
    let repository = state.store.repository(&id).await?;
    ensure_active_project(&state.store.project(&repository.project_id).await?)?;
    let mut observed = state.store.repository_as_directory(&id).await?;
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
    state.store.refresh_repository(&updated).await?;
    Ok(Json(state.store.repository(&id).await?))
}

#[derive(Deserialize)]
pub(super) struct ReattachProjectRepository {
    path: String,
    preferred_remote_name: Option<String>,
    #[serde(default)]
    confirm_unverified: bool,
}

pub(super) async fn reattach_project_repository(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<ReattachProjectRepository>,
) -> Result<Json<Directory>> {
    let current = state.store.repository_as_directory(&id).await?;
    ensure_active_project(&state.store.project(&current.project_id).await?)?;
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
    let active_locations = state
        .store
        .workspace_repositories_for_project_repository(&id)
        .await?;
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
    state
        .store
        .reattach_repository(
            &id,
            &candidate,
            &common_dir,
            current.repository_url.as_deref(),
            preferred,
        )
        .await?;
    let repository = refresh_project_repository(State(state.clone()), AxumPath(id)).await?;
    Ok(Json(
        state.store.repository_as_directory(&repository.id).await?,
    ))
}

pub(super) async fn resync_workspace(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<WorkspaceDetail>> {
    let workspace = state.store.workspace(&id).await?;
    ensure_active_workspace(&workspace)?;

    let mut succeeded = 0usize;
    let mut failed = 0usize;
    for location in state.store.workspace_repositories(&id).await? {
        let Some(checkout_path) = location.checkout_path.as_deref() else {
            state
                .store
                .set_workspace_repository_creation_error(&location.id, "checkout path is missing")
                .await?;
            failed += 1;
            continue;
        };
        if !Path::new(checkout_path).is_dir() {
            state
                .store
                .set_workspace_repository_creation_result(
                    &location.id,
                    "missing",
                    Some(checkout_path),
                    location.start_commit.as_deref(),
                    Some("checkout directory is missing"),
                )
                .await?;
            failed += 1;
            continue;
        }
        let repository = match state
            .store
            .repository(&location.project_repository_id)
            .await
        {
            Ok(repository) => repository,
            Err(_) => {
                state
                    .store
                    .set_workspace_repository_creation_result(
                        &location.id,
                        "broken",
                        Some(checkout_path),
                        location.start_commit.as_deref(),
                        Some("Project repository is missing or removed"),
                    )
                    .await?;
                failed += 1;
                continue;
            }
        };
        if !Path::new(&repository.source_root).is_dir() {
            state
                .store
                .set_workspace_repository_creation_result(
                    &location.id,
                    "broken",
                    Some(checkout_path),
                    location.start_commit.as_deref(),
                    Some("Project repository source is missing"),
                )
                .await?;
            failed += 1;
            continue;
        }
        let registered = match git_worktrees(&repository.source_root) {
            Ok(registered) => registered,
            Err(error) => {
                state
                    .store
                    .set_workspace_repository_creation_result(
                        &location.id,
                        "broken",
                        Some(checkout_path),
                        location.start_commit.as_deref(),
                        Some(&format!("cannot list worktrees: {error}")),
                    )
                    .await?;
                failed += 1;
                continue;
            }
        };
        if !registered
            .iter()
            .any(|item| normalized_path(&item.path) == normalized_path(checkout_path))
        {
            state
                .store
                .set_workspace_repository_creation_result(
                    &location.id,
                    "missing",
                    Some(checkout_path),
                    location.start_commit.as_deref(),
                    Some("checkout is not registered as a worktree"),
                )
                .await?;
            failed += 1;
            continue;
        }
        if let Err(error) = command_output(
            Path::new(&repository.source_root),
            "git",
            &["worktree", "repair", checkout_path],
        ) {
            state
                .store
                .set_workspace_repository_creation_result(
                    &location.id,
                    "broken",
                    Some(checkout_path),
                    location.start_commit.as_deref(),
                    Some(&format!("worktree repair failed: {error}")),
                )
                .await?;
            failed += 1;
            continue;
        }
        let probe = command_output(Path::new(checkout_path), "git", &["rev-parse", "--git-dir"]);
        match probe {
            Ok(_) => {
                state
                    .store
                    .set_workspace_repository_creation_result(
                        &location.id,
                        "ready",
                        Some(checkout_path),
                        location.start_commit.as_deref(),
                        None,
                    )
                    .await?;
                succeeded += 1;
            }
            Err(error) => {
                state
                    .store
                    .set_workspace_repository_creation_result(
                        &location.id,
                        "broken",
                        Some(checkout_path),
                        location.start_commit.as_deref(),
                        Some(&format!("worktree probe failed: {error}")),
                    )
                    .await?;
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
    let repository = state.store.repository(&id).await?;
    ensure_active_project(&state.store.project(&repository.project_id).await?)?;
    state.store.delete_repository(&id).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub(super) async fn delete_project_directory(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<StatusCode> {
    let location = state.store.directory(&id).await?;
    let project = state.store.project(&location.project_id).await?;
    ensure_active_project(&project)?;
    state.store.delete_project_directory(&id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub(super) struct UpdateDirectory {
    name: Option<String>,
    description: Option<String>,
    worktree_setup_command: Option<String>,
}
pub(super) async fn update_directory(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<UpdateDirectory>,
) -> Result<Json<Directory>> {
    let current = state.store.directory(&id).await?;
    ensure_active_project(&state.store.project(&current.project_id).await?)?;
    let name = trimmed(input.name)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| current.name.clone());
    state
        .store
        .update_directory(
            &id,
            &name,
            trimmed(input.description).unwrap_or_default().as_str(),
            trimmed(input.worktree_setup_command)
                .unwrap_or_default()
                .as_str(),
        )
        .await?;
    let mut directory = state.store.directory(&id).await?;
    enrich_directory(&mut directory, None);
    Ok(Json(directory))
}

#[derive(Deserialize)]
pub(super) struct UpdateProjectRepository {
    setup_command: Option<String>,
    setup_workdir: Option<String>,
    preferred_remote_name: Option<String>,
}

pub(super) async fn update_project_repository(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<UpdateProjectRepository>,
) -> Result<Json<ProjectRepository>> {
    let current = state.store.repository(&id).await?;
    ensure_active_project(&state.store.project(&current.project_id).await?)?;
    let remote = input
        .preferred_remote_name
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty());
    if let Some(remote) = remote {
        if !git_remote_names(&current.source_root)?
            .iter()
            .any(|name| name == remote)
        {
            return Err(AppError::BadRequest("remote was not found".into()));
        }
    }
    let setup_workdir = validate_setup_workdir(
        &current.source_root,
        trimmed(input.setup_workdir)
            .filter(|value| !value.is_empty())
            .as_deref()
            .unwrap_or(&current.setup_workdir),
    )?;
    state
        .store
        .update_repository(
            &id,
            trimmed(input.setup_command)
                .unwrap_or(current.setup_command)
                .as_str(),
            &setup_workdir,
            input.preferred_remote_name.as_ref().map(|_| remote),
        )
        .await?;
    Ok(Json(state.store.repository(&id).await?))
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
    pub current_remote: Option<String>,
    pub(super) current: String,
    pub(super) local: Vec<String>,
    pub(super) remotes: Vec<GitRemoteBranches>,
}

pub(super) async fn list_directory_branches(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<GitBranches>> {
    let directory = state.store.repository_as_directory(&id).await?;
    blocking_git_operation(move || async move {
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
    let repository = state.store.repository(&id).await?;
    blocking_git_operation_for(repository.git_common_dir.clone(), move || async move {
        delete_directory_branch_impl(state, id, input).await
    })
    .await
}

pub(super) async fn delete_directory_branch_impl(
    state: AppState,
    id: String,
    input: DeleteDirectoryBranch,
) -> Result<Json<GitBranches>> {
    let repository = state.store.repository(&id).await?;
    ensure_active_project(&state.store.project(&repository.project_id).await?)?;
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
    let repository = state.store.repository(&id).await?;
    let result = blocking_git_operation_for(repository.git_common_dir, move || async move {
        checkout_directory_branch_impl(state, id, input).await
    })
    .await?;
    Ok(result)
}

pub(super) async fn checkout_directory_branch_impl(
    state: AppState,
    id: String,
    input: CheckoutDirectoryBranch,
) -> Result<Json<Directory>> {
    let mut directory = state.store.repository_as_directory(&id).await?;
    ensure_active_project(&state.store.project(&directory.project_id).await?)?;
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
    pub(super) repository_remotes: Option<std::collections::HashMap<String, String>>,
    pub(super) expected_base_branches: Option<std::collections::HashMap<String, String>>,
    pub(super) description: Option<String>,
    pub(super) branch: Option<String>,
    pub(super) remote_name: Option<String>,
    pub(super) remote_branch: Option<String>,
    pub(super) generated_branch: Option<String>,
}

#[derive(Clone)]
pub(super) struct WorkspaceWorktreePlan {
    pub(super) location: Directory,
    pub(super) workspace_repository_id: String,
    pub(super) checkout_path: String,
    pub(super) branch: String,
    pub(super) start_ref: String,
    pub(super) reuse_branch: bool,
    pub(super) setup_directory_id: String,
    pub(super) setup_workdir: String,
}

pub(super) struct WorkspaceWorktreeOutcome {
    plan: WorkspaceWorktreePlan,
    start_commit: Option<String>,
    error: Option<String>,
}

pub(super) struct WorkspaceSetupShell {
    workspace_repository_id: String,
    project_repository_id: String,
    repository_name: String,
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
    let created = blocking_git_operation(move || async move {
        create_workspace_impl(operation_state, project_id, input).await
    })
    .await?;
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

pub(super) async fn create_workspace_impl(
    state: AppState,
    project_id: String,
    input: CreateWorkspace,
) -> Result<CreatedWorkspace> {
    create_workspace_with_existing_worktree(state, project_id, input, Vec::new()).await
}

pub(super) struct ExistingWorkspaceWorktree {
    pub(super) project_repository_id: String,
    pub(super) path: String,
    pub(super) branch: String,
}

pub(super) async fn create_workspace_with_existing_worktree(
    state: AppState,
    project_id: String,
    input: CreateWorkspace,
    existing: Vec<ExistingWorkspaceWorktree>,
) -> Result<CreatedWorkspace> {
    let project = state.store.project(&project_id).await?;
    if project.status != "active" {
        return Err(AppError::BadRequest(
            "cannot create a Workspace in an archived Project".into(),
        ));
    }
    let directories = state.store.project_directories(&project_id).await?;
    let repositories = state.store.repositories(&project_id).await?;
    let mut locations = Vec::new();
    for repository in &repositories {
        locations.push(state.store.repository_as_directory(&repository.id).await?);
    }
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
    let workspace_id = new_id();
    let explicit_branch = trimmed(input.branch).filter(|value| !value.is_empty());
    let new_locations = locations
        .iter()
        .filter(|location| {
            !existing
                .iter()
                .any(|worktree| worktree.project_repository_id == location.id)
        })
        .cloned()
        .collect::<Vec<_>>();
    let (branch, worktree_root) = super::worktree_names::reserve_shared_worktree(
        &state.settings,
        &new_locations,
        explicit_branch.as_deref(),
        trimmed(input.generated_branch)
            .filter(|value| !value.is_empty())
            .as_deref(),
        true,
    )?;
    let timestamp = now();
    let mut snapshots = Vec::new();
    let mut plans = Vec::new();
    for location in &locations {
        let base_branch = current_project_branch(&location.path)?;
        if let Some(expected) = input.expected_base_branches.as_ref() {
            if expected.get(&location.id) != Some(&base_branch) {
                return Err(AppError::BadRequest(format!(
                    "Repository '{}' current branch changed; reopen Workspace creation to review its base",
                    location.name
                )));
            }
        }
        if let Some(worktree) = existing
            .iter()
            .find(|worktree| worktree.project_repository_id == location.id)
        {
            let options = directory_branches(&worktree.path)?;
            let remote_branch = command_output(
                Path::new(&worktree.path),
                "git",
                &[
                    "for-each-ref",
                    "--format=%(upstream:remoteref)",
                    &format!("refs/heads/{}", worktree.branch),
                ],
            )
            .ok()
            .and_then(|value| value.strip_prefix("refs/heads/").map(str::to_owned));
            let mut snapshot = git_workspace_repository(
                &workspace_id,
                location,
                &timestamp,
                worktree.path.clone(),
                worktree.branch.clone(),
                base_branch,
                git_head(&worktree.path)?,
                None,
                options.current_remote,
                remote_branch,
            );
            snapshot.branch_ownership = "user".into();
            snapshot.worktree_ownership = "external".into();
            snapshots.push(snapshot);
            continue;
        }
        let checkout_path = worktree_root
            .path()
            .join(repository_slug(&location.name))
            .to_string_lossy()
            .into_owned();
        let inherited_remote = directory_branches(&location.path)?.current_remote;
        let remote_name = input
            .repository_remotes
            .as_ref()
            .and_then(|values| values.get(&location.id))
            .cloned()
            .or_else(|| {
                if location.id == default_repository_id {
                    trimmed(input.remote_name.clone())
                } else {
                    None
                }
            })
            .or(inherited_remote)
            .filter(|value| !value.is_empty());
        if let Some(remote) = remote_name.as_deref() {
            if !git_remote_names(&location.path)?
                .iter()
                .any(|name| name == remote)
            {
                return Err(AppError::BadRequest(format!(
                    "Repository '{}' remote was not found",
                    location.name
                )));
            }
        }
        let remote_branch = remote_name.as_ref().map(|_| {
            if location.id == default_repository_id {
                trimmed(input.remote_branch.clone())
                    .filter(|v| !v.is_empty())
                    .unwrap_or_else(|| branch.clone())
            } else {
                branch.clone()
            }
        });
        let mut snapshot = git_workspace_repository(
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
        );
        let reuse_branch = explicit_branch.is_some()
            && git_ref_names(&location.path, "refs/heads")?.contains(&branch);
        if reuse_branch {
            snapshot.branch_ownership = "user".into();
        }
        snapshot.git_status = "creating".into();
        snapshot.start_commit = None;
        plans.push(WorkspaceWorktreePlan {
            location: location.clone(),
            workspace_repository_id: snapshot.id.clone(),
            checkout_path,
            branch: branch.clone(),
            start_ref: if reuse_branch {
                format!("refs/heads/{branch}")
            } else {
                git_head(&location.path)?
            },
            reuse_branch,
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
        name: branch.clone(),
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
        delivery_status: "active".into(),
        close_outcome: None,
        integrated_commit: None,
        closed_at: None,
    };
    state
        .store
        .create_workspace_with_repositories(&workspace, &snapshots)
        .await?;

    let outcomes = create_workspace_worktrees(plans);
    let setup_shells = record_workspace_worktree_outcomes(&state.store, outcomes).await?;

    Ok(CreatedWorkspace {
        workspace: state.store.workspace(&workspace.id).await?,
        setup_shells,
    })
}

pub(super) fn managed_repository_source_path(
    settings: &SettingsStore,
    project_id: &str,
    repository_name: &str,
) -> PathBuf {
    settings
        .treefold_home()
        .join("git")
        .join("s")
        .join(slug(project_id))
        .join(repository_slug(repository_name))
}

/// Resolve the Repository root for a Project Directory scope.
#[cfg(test)]
pub(super) async fn repository_root_for_directory(
    state: &AppState,
    directory_id: &str,
) -> Result<String> {
    let repository_id = state
        .store
        .directory_repository_id(directory_id)
        .await?
        .ok_or_else(|| AppError::BadRequest("directory is not attached to a Repository".into()))?;
    Ok(state.store.repository(&repository_id).await?.source_root)
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
                "starting branch '{}' was not found in {}",
                plan.start_ref, plan.location.name
            )
        })?;
        if let Some(parent) = Path::new(&plan.checkout_path).parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("create worktree directory: {error}"))?;
        }
        let args = if plan.reuse_branch {
            vec!["worktree", "add", "--", &plan.checkout_path, &plan.branch]
        } else {
            vec![
                "worktree",
                "add",
                "-b",
                &plan.branch,
                "--",
                &plan.checkout_path,
                &plan.start_ref,
            ]
        };
        command_output(Path::new(&plan.location.path), "git", &args)
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

pub(super) async fn record_workspace_worktree_outcomes(
    store: &Store,
    outcomes: Vec<WorkspaceWorktreeOutcome>,
) -> Result<Vec<WorkspaceSetupShell>> {
    let mut setup_shells = Vec::new();
    for outcome in outcomes {
        if let Some(error) = outcome.error.as_deref() {
            store
                .set_workspace_repository_creation_result(
                    &outcome.plan.workspace_repository_id,
                    "failed",
                    None,
                    outcome.start_commit.as_deref(),
                    Some(error),
                )
                .await?;
            continue;
        }
        store
            .set_workspace_repository_creation_result(
                &outcome.plan.workspace_repository_id,
                "ready",
                Some(&outcome.plan.checkout_path),
                outcome.start_commit.as_deref(),
                None,
            )
            .await?;
        let command = outcome.plan.location.worktree_setup_command.trim();
        if !command.is_empty() {
            let setup_path =
                Path::new(&outcome.plan.checkout_path).join(&outcome.plan.setup_workdir);
            let command = format!(
                "cd {} && {command}",
                shell_quote(&setup_path.to_string_lossy())
            );
            setup_shells.push(WorkspaceSetupShell {
                workspace_repository_id: outcome.plan.workspace_repository_id,
                project_repository_id: outcome.plan.setup_directory_id,
                repository_name: outcome.plan.location.name,
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
                name: Some(format!("setup · {}", setup.repository_name)),
                kind: Some("shell".into()),
                project_directory_id: Some(setup.project_repository_id),
                initial_prompt: Some(setup.command),
            },
        )
        .await;
        if let Err(error) = result {
            let message = format!("could not start setup shell: {error}");
            let _ = state
                .store
                .set_workspace_repository_creation_error(&setup.workspace_repository_id, &message);
            log::error!("{message}");
        }
    }
}

pub(super) async fn spawn_workspace_setup_shells(
    state: AppState,
    workspace: Workspace,
    setup_shells: Vec<WorkspaceSetupShell>,
) {
    if setup_shells.is_empty() {
        return;
    }
    crate::request_context::spawn(async move {
        start_workspace_setup_shells(&state, &workspace, setup_shells).await;
    });
}

pub(super) async fn get_workspace(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<WorkspaceDetail>> {
    let mut detail = state.store.workspace_detail(&id).await?;
    for location in &mut detail.repositories {
        if detail.workspace.status != "active" {
            continue;
        }
        if location.access_mode == "read_only" {
            location.git_status = if Path::new(&location.source_root).is_dir() {
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
    ensure_active_workspace(&state.store.workspace(&id).await?)?;
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest(
            "Workspace name cannot be empty".into(),
        ));
    }
    state
        .store
        .rename_workspace(&id, name, &input.description)
        .await?;
    Ok(Json(state.store.workspace(&id).await?))
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
pub(super) struct UpdateWorkspaceRepository {
    pub(super) remote_name: Option<String>,
    pub(super) remote_branch: Option<String>,
}

pub(super) async fn update_workspace_repository(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<UpdateWorkspaceRepository>,
) -> Result<Json<WorkspaceRepository>> {
    let location = state.store.workspace_repository(&id).await?;
    let workspace = state.store.workspace(&location.workspace_id).await?;
    ensure_active_workspace(&workspace)?;
    if workspace.kind != "workspace" {
        return Err(AppError::BadRequest(
            "remote upstream settings are available only for a root Workspace".into(),
        ));
    }
    let path = workspace_repository_git_path(&location)?;
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
                "Workspace Repository remote was not found".into(),
            ));
        }
    }
    state
        .store
        .update_workspace_delivery(&id, remote_name.as_deref(), remote_branch.as_deref())
        .await?;
    Ok(Json(state.store.workspace_repository(&id).await?))
}
