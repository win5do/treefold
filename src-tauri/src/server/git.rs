async fn get_workspace_git_history(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<GitHistory>> {
    blocking_git_operation(move || {
        let repository = state.store.default_workspace_location(&id)?;
        Ok(Json(git_history(workspace_location_git_path(&repository)?)?))
    })
    .await
}

async fn get_project_location_git_history(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<GitHistory>> {
    blocking_git_operation(move || {
        let mut location = state.store.repository_as_directory(&id)?;
        refresh_location_observation(&mut location)?;
        ensure_location_ready(&location)?;
        Ok(Json(git_history(&location.path)?))
    })
    .await
}

async fn get_workspace_location_git_history(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<GitHistory>> {
    blocking_git_operation(move || {
        let location = state.store.workspace_location(&id)?;
        let path = workspace_location_git_path(&location)?;
        Ok(Json(git_history(path)?))
    })
    .await
}

async fn pull_project_location(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<GitSyncResult>> {
    let location = state.store.repository_as_directory(&id)?;
    let project = state.store.project(&location.project_id)?;
    ensure_active_project(&project)?;
    let common = location
        .git_common_dir
        .clone()
        .ok_or_else(|| AppError::BadRequest("Repository has no Git common directory".into()))?;
    git::with_repository_lock(Path::new(&common), || async {
        Ok(Json(sync_project_location(&location, &project, "pull").await?))
    })
    .await
}

async fn push_project_location(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<GitSyncResult>> {
    let location = state.store.repository_as_directory(&id)?;
    let project = state.store.project(&location.project_id)?;
    ensure_active_project(&project)?;
    let common = location
        .git_common_dir
        .clone()
        .ok_or_else(|| AppError::BadRequest("Repository has no Git common directory".into()))?;
    git::with_repository_lock(Path::new(&common), || async {
        Ok(Json(sync_project_location(&location, &project, "push").await?))
    })
    .await
}

async fn pull_workspace_location(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<GitSyncResult>> {
    let location = state.store.workspace_location(&id)?;
    ensure_active_workspace(&state.store.workspace(&location.workspace_id)?)?;
    let common = state
        .store
        .repository(&location.project_location_id)?
        .git_common_dir;
    git::with_repository_lock(Path::new(&common), || async {
        Ok(Json(sync_workspace_location(&location, "pull").await?))
    })
    .await
}

async fn push_workspace_location(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<GitSyncResult>> {
    let location = state.store.workspace_location(&id)?;
    ensure_active_workspace(&state.store.workspace(&location.workspace_id)?)?;
    let common = state
        .store
        .repository(&location.project_location_id)?
        .git_common_dir;
    git::with_repository_lock(Path::new(&common), || async {
        Ok(Json(sync_workspace_location(&location, "push").await?))
    })
    .await
}

async fn pull_all_project(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Vec<GitSyncItemResult>>> {
    sync_all_project_locations(&state, &id, "pull").await
}
async fn push_all_project(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Vec<GitSyncItemResult>>> {
    sync_all_project_locations(&state, &id, "push").await
}
async fn sync_all_project_locations(
    state: &AppState,
    project_id: &str,
    action: &str,
) -> Result<Json<Vec<GitSyncItemResult>>> {
    let project = state.store.project(project_id)?;
    ensure_active_project(&project)?;
    let mut results = Vec::new();
    for repository in state.store.repositories(project_id)? {
        let location = state.store.repository_as_directory(&repository.id)?;
        match sync_project_location(&location, &project, action).await {
            Ok(result) => results.push(GitSyncItemResult {
                project_location_id: location.id,
                workspace_location_id: None,
                location_name: location.name,
                status: "success".into(),
                result: Some(result),
                error: None,
            }),
            Err(error) => results.push(GitSyncItemResult {
                project_location_id: location.id,
                workspace_location_id: None,
                location_name: location.name,
                status: "failed".into(),
                result: None,
                error: Some(error.to_string()),
            }),
        }
    }
    Ok(Json(results))
}

async fn pull_all_workspace(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Vec<GitSyncItemResult>>> {
    sync_all_workspace_locations(&state, &id, "pull").await
}
async fn push_all_workspace(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Vec<GitSyncItemResult>>> {
    sync_all_workspace_locations(&state, &id, "push").await
}
async fn sync_all_workspace_locations(
    state: &AppState,
    workspace_id: &str,
    action: &str,
) -> Result<Json<Vec<GitSyncItemResult>>> {
    ensure_active_workspace(&state.store.workspace(workspace_id)?)?;
    let mut results = Vec::new();
    for location in state.store.workspace_locations(workspace_id)? {
        if location.access_mode != "read_write" {
            results.push(GitSyncItemResult {
                project_location_id: location.project_location_id,
                workspace_location_id: Some(location.id),
                location_name: location.location_name,
                status: "skipped".into(),
                result: None,
                error: None,
            });
            continue;
        }
        if location.remote_name.is_none() || location.remote_branch.is_none() {
            results.push(GitSyncItemResult {
                project_location_id: location.project_location_id,
                workspace_location_id: Some(location.id),
                location_name: location.location_name,
                status: "skipped".into(),
                result: None,
                error: Some("upstream is not configured".into()),
            });
            continue;
        }
        match sync_workspace_location(&location, action).await {
            Ok(result) => results.push(GitSyncItemResult {
                project_location_id: location.project_location_id,
                workspace_location_id: Some(location.id),
                location_name: location.location_name,
                status: "success".into(),
                result: Some(result),
                error: None,
            }),
            Err(error) => results.push(GitSyncItemResult {
                project_location_id: location.project_location_id,
                workspace_location_id: Some(location.id),
                location_name: location.location_name,
                status: "failed".into(),
                result: None,
                error: Some(error.to_string()),
            }),
        }
    }
    Ok(Json(results))
}

fn ensure_location_ready(location: &ProjectLocation) -> Result<()> {
    let mut observed = location.clone();
    refresh_location_observation(&mut observed)?;
    if observed.git_status != "ready" {
        return Err(AppError::BadRequest(format!(
            "location unavailable: {}",
            observed.git_status
        )));
    }
    Ok(())
}

async fn sync_project_location(
    location: &ProjectLocation,
    project: &Project,
    action: &str,
) -> Result<GitSyncResult> {
    ensure_location_ready(location)?;
    let branch = location
        .base_branch
        .clone()
        .unwrap_or_else(|| project.default_base_branch.clone());
    let remote = location
        .preferred_remote_name
        .clone()
        .ok_or_else(|| AppError::BadRequest("location has no preferred remote".into()))?;
    let before_head = command_output(Path::new(&location.path), "git", &["rev-parse", &branch])
        .map_err(AppError::BadRequest)?;
    if action == "pull" {
        ensure_clean_workspace(&location.path, "Project location")?;
        ensure_checked_out_branch(&location.path, &branch, "Project location")?;
        fetch_remote_branch_async(&location.path, &remote, &branch).await?;
        git::output_async(
            Path::new(&location.path),
            &["merge", "--ff-only", "FETCH_HEAD"],
        )
        .await
        .map_err(AppError::BadRequest)?;
    } else {
        git::output_async(
            Path::new(&location.path),
            &["push", &remote, &format!("{branch}:{branch}")],
        )
        .await
        .map_err(AppError::BadRequest)?;
    }
    let after_head = command_output(Path::new(&location.path), "git", &["rev-parse", &branch])
        .map_err(AppError::BadRequest)?;
    Ok(sync_result(
        "project_repository",
        action,
        &branch,
        &remote,
        &branch,
        before_head,
        after_head,
    ))
}

fn workspace_location_git_path(location: &WorkspaceLocation) -> Result<&str> {
    if location.access_mode != "read_write" || location.git_status != "ready" {
        return Err(AppError::BadRequest(
            "workspace location is not Git-enabled".into(),
        ));
    }
    let path = location
        .checkout_path
        .as_deref()
        .ok_or_else(|| AppError::BadRequest("workspace location has no worktree".into()))?;
    if !Path::new(path).is_dir() {
        return Err(AppError::BadRequest(
            "workspace location unavailable: worktree is missing".into(),
        ));
    }
    command_output(
        Path::new(path),
        "git",
        &["rev-parse", "--is-inside-work-tree"],
    )
    .map_err(|_| {
        AppError::BadRequest("workspace location unavailable: Git metadata is broken".into())
    })?;
    Ok(path)
}

async fn sync_workspace_location(
    location: &WorkspaceLocation,
    action: &str,
) -> Result<GitSyncResult> {
    let path = workspace_location_git_path(location)?;
    let branch = location
        .branch
        .as_deref()
        .ok_or_else(|| AppError::BadRequest("workspace location has no branch".into()))?;
    let remote = location.remote_name.as_deref().ok_or_else(|| {
        AppError::BadRequest("workspace location has no remote configured".into())
    })?;
    let remote_branch = location.remote_branch.as_deref().ok_or_else(|| {
        AppError::BadRequest("workspace location has no remote branch configured".into())
    })?;
    ensure_checked_out_branch(path, branch, "Workspace location")?;
    let before_head = git_head(path)?;
    if action == "pull" {
        ensure_clean_workspace(path, "Workspace location")?;
        fetch_remote_branch_async(path, remote, remote_branch).await?;
        if !git_is_ancestor_async(path, &before_head, "FETCH_HEAD").await? {
            return Err(AppError::BadRequest(
                "Workspace location and upstream have diverged".into(),
            ));
        }
        git::output_async(Path::new(path), &["merge", "--ff-only", "FETCH_HEAD"])
            .await
            .map_err(AppError::BadRequest)?;
    } else {
        git::output_async(
            Path::new(path),
            &["push", remote, &format!("{branch}:{remote_branch}")],
        )
        .await
        .map_err(AppError::BadRequest)?;
    }
    Ok(sync_result(
        "workspace_repository",
        action,
        branch,
        remote,
        remote_branch,
        before_head,
        git_head(path)?,
    ))
}


async fn archive_workspace(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Workspace>> {
    state.store.archive_workspace(&id)?;
    for mut session in state.store.sessions(&id)? {
        capture_codex_session_id(&state.store, &mut session)?;
        let _ = state.terminals.stop_existing(&session.amux_workspace_name, &session.amux_process_name).await;
        state.store.set_session_status(&session.id, "stopped")?;
    }
    Ok(Json(state.store.workspace(&id)?))
}

async fn pull_project(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<GitSyncResult>> {
    let project = state.store.project(&id)?;
    let directory = state.store.directory(&project.primary_directory_id)?;
    ensure_git_directory(&directory)?;
    ensure_clean_workspace(&directory.path, "Project source checkout")?;
    ensure_checked_out_branch(
        &directory.path,
        &project.default_target_branch,
        "Project source checkout",
    )?;
    let remote = project
        .preferred_remote
        .ok_or_else(|| AppError::BadRequest("Project has no preferred remote".into()))?;
    let remote_branch = project.default_target_branch.clone();
    let before_head = git_head(&directory.path)?;
    fetch_remote_branch_async(&directory.path, &remote, &remote_branch).await?;
    git::output_async(
        Path::new(&directory.path),
        &["merge", "--ff-only", "FETCH_HEAD"],
    )
    .await
    .map_err(|error| {
        AppError::BadRequest(format!(
            "Project target cannot fast-forward from {remote}/{remote_branch}: {error}"
        ))
    })?;
    let after_head = git_head(&directory.path)?;
    Ok(Json(sync_result(
        "project",
        "pull",
        &project.default_target_branch,
        &remote,
        &remote_branch,
        before_head,
        after_head,
    )))
}

async fn push_project(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<GitSyncResult>> {
    let project = state.store.project(&id)?;
    let directory = state.store.directory(&project.primary_directory_id)?;
    ensure_git_directory(&directory)?;
    let remote = project
        .preferred_remote
        .ok_or_else(|| AppError::BadRequest("Project has no preferred remote".into()))?;
    let remote_branch = project.default_target_branch.clone();
    let before_head = command_output(
        Path::new(&directory.path),
        "git",
        &["rev-parse", &project.default_target_branch],
    )
    .map_err(AppError::BadRequest)?;
    let refspec = format!("{}:{remote_branch}", project.default_target_branch);
    git::output_async(Path::new(&directory.path), &["push", &remote, &refspec])
        .await
        .map_err(AppError::BadRequest)?;
    Ok(Json(sync_result(
        "project",
        "push",
        &project.default_target_branch,
        &remote,
        &remote_branch,
        before_head.clone(),
        before_head,
    )))
}

async fn pull_workspace(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<GitSyncResult>> {
    let workspace = state.store.workspace(&id)?;
    ensure_active_workspace(&workspace)?;
    if workspace.kind != "workspace" {
        return Err(AppError::BadRequest(
            "Git Pull is available only for a root Workspace; Forks follow their parent locally"
                .into(),
        ));
    }
    let (remote, remote_branch) = workspace_upstream(&workspace)?;
    ensure_clean_workspace(&workspace.checkout_path, "Workspace")?;
    ensure_checked_out_branch(&workspace.checkout_path, &workspace.branch, "Workspace")?;
    let before_head = git_head(&workspace.checkout_path)?;
    fetch_remote_branch_async(&workspace.checkout_path, &remote, &remote_branch).await?;
    let remote_head = command_output(
        Path::new(&workspace.checkout_path),
        "git",
        &["rev-parse", "FETCH_HEAD"],
    )
    .map_err(AppError::BadRequest)?;
    if before_head != remote_head {
        if git_is_ancestor_async(&workspace.checkout_path, &before_head, &remote_head).await? {
            git::output_async(
                Path::new(&workspace.checkout_path),
                &["merge", "--ff-only", "FETCH_HEAD"],
            )
            .await
            .map_err(AppError::BadRequest)?;
        } else if !git_is_ancestor_async(&workspace.checkout_path, &remote_head, &before_head)
            .await?
        {
            return Err(AppError::BadRequest(format!(
                "Workspace and {remote}/{remote_branch} have diverged; rebase or merge explicitly"
            )));
        }
    }
    let after_head = git_head(&workspace.checkout_path)?;
    Ok(Json(sync_result(
        "workspace",
        "pull",
        &workspace.branch,
        &remote,
        &remote_branch,
        before_head,
        after_head,
    )))
}

async fn push_workspace(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<GitSyncResult>> {
    let workspace = state.store.workspace(&id)?;
    ensure_active_workspace(&workspace)?;
    if workspace.kind != "workspace" {
        return Err(AppError::BadRequest(
            "Git Push is available only for a root Workspace; Forks have no remote branch".into(),
        ));
    }
    let (remote, remote_branch) = workspace_upstream(&workspace)?;
    ensure_checked_out_branch(&workspace.checkout_path, &workspace.branch, "Workspace")?;
    let before_head = git_head(&workspace.checkout_path)?;
    let refspec = format!("{}:{remote_branch}", workspace.branch);
    git::output_async(
        Path::new(&workspace.checkout_path),
        &["push", "--set-upstream", &remote, &refspec],
    )
    .await
    .map_err(AppError::BadRequest)?;
    state.store.set_delivery_status(&id, "published")?;
    Ok(Json(sync_result(
        "workspace",
        "push",
        &workspace.branch,
        &remote,
        &remote_branch,
        before_head.clone(),
        before_head,
    )))
}

fn ensure_active_workspace(workspace: &Workspace) -> Result<()> {
    if workspace.status != "active" || workspace.kind == "base" {
        return Err(AppError::BadRequest("Workspace is not active".into()));
    }
    Ok(())
}

fn workspace_upstream(workspace: &Workspace) -> Result<(String, String)> {
    let remote = workspace
        .remote_name
        .clone()
        .ok_or_else(|| AppError::BadRequest("Workspace has no remote configured".into()))?;
    let branch = workspace
        .remote_branch
        .clone()
        .ok_or_else(|| AppError::BadRequest("Workspace has no remote branch configured".into()))?;
    Ok((remote, branch))
}

fn fetch_remote_branch(repository: &str, remote: &str, branch: &str) -> Result<()> {
    command_output(
        Path::new(repository),
        "git",
        &["fetch", "--no-tags", remote, branch],
    )
    .map_err(AppError::BadRequest)?;
    Ok(())
}

async fn fetch_remote_branch_async(repository: &str, remote: &str, branch: &str) -> Result<()> {
    git::output_async(
        Path::new(repository),
        &["fetch", "--no-tags", remote, branch],
    )
    .await
    .map_err(AppError::BadRequest)?;
    Ok(())
}

fn sync_result(
    scope: &str,
    action: &str,
    branch: &str,
    remote: &str,
    remote_branch: &str,
    before_head: String,
    after_head: String,
) -> GitSyncResult {
    let status = if before_head == after_head {
        "up_to_date"
    } else {
        "updated"
    };
    GitSyncResult {
        scope: scope.into(),
        action: action.into(),
        branch: branch.into(),
        remote: remote.into(),
        remote_branch: remote_branch.into(),
        before_head,
        after_head,
        status: status.into(),
        message: format!("{action} {status}"),
    }
}

fn id() -> String {
    Uuid::new_v4().simple().to_string()
}
fn trimmed(value: Option<String>) -> Option<String> {
    value.map(|v| v.trim().to_owned())
}
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}
fn basename(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or("workspace")
        .to_owned()
}
fn inspect_path(value: &str) -> Result<(String, bool)> {
    let path = std::fs::canonicalize(value)
        .map_err(|e| AppError::BadRequest(format!("invalid workspace path: {e}")))?;
    if !path.is_dir() {
        return Err(AppError::BadRequest(
            "workspace path must be a directory".into(),
        ));
    }
    let string = path.to_string_lossy().into_owned();
    let is_git = git::output(Path::new(&string), &["rev-parse", "--is-inside-work-tree"]).is_ok();
    Ok((string, is_git))
}

fn refresh_location_observation(location: &mut ProjectLocation) -> Result<()> {
    location.last_checked_at = Some(now());
    let path = Path::new(&location.path);
    if !path.exists() {
        location.git_status = "missing".into();
        return Ok(());
    }
    if !path.is_dir() {
        location.git_status = "broken".into();
        return Ok(());
    }
    let inside = command_output(path, "git", &["rev-parse", "--is-inside-work-tree"]).is_ok();
    if !inside {
        location.git_status = if location.git_common_dir.is_some() {
            "broken"
        } else {
            "not_git"
        }
        .into();
        location.is_git = false;
        return Ok(());
    }
    let common_dir = command_output(
        path,
        "git",
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )
    .map_err(AppError::BadRequest)?;
    let source_root = command_output(path, "git", &["rev-parse", "--show-toplevel"])
        .map_err(AppError::BadRequest)?;
    let remote_names = git_remote_names(&location.path)?;
    let remote = location
        .preferred_remote_name
        .clone()
        .filter(|name| remote_names.contains(name))
        .or_else(|| {
            remote_names
                .iter()
                .find(|name| name.as_str() == "origin")
                .cloned()
        })
        .or_else(|| remote_names.first().cloned());
    let repository_url = remote
        .as_ref()
        .and_then(|name| command_output(path, "git", &["remote", "get-url", name]).ok());
    if let (Some(expected), Some(observed)) = (
        location.repository_url.as_deref(),
        repository_url.as_deref(),
    ) {
        if !repository_identity_matches(expected, observed) {
            location.git_status = "mismatch".into();
            return Ok(());
        }
    }
    location.git_common_dir = Some(common_dir);
    location.checkout_path = Some(source_root);
    location.preferred_remote_name = remote;
    location.repository_url = repository_url.or_else(|| location.repository_url.clone());
    location.base_branch = location.base_branch.clone().or_else(|| {
        command_output(path, "git", &["branch", "--show-current"])
            .ok()
            .filter(|value| !value.is_empty())
    });
    location.git_status = "ready".into();
    location.is_git = true;
    location.remote_url = location.repository_url.clone();
    Ok(())
}

fn repository_identity_matches(expected: &str, observed: &str) -> bool {
    fn normalize(value: &str) -> String {
        value
            .trim()
            .trim_end_matches(".git")
            .trim_end_matches('/')
            .replace("git@", "")
            .replace(':', "/")
            .to_ascii_lowercase()
    }
    normalize(expected) == normalize(observed)
}
fn command_output(dir: &Path, program: &str, args: &[&str]) -> std::result::Result<String, String> {
    if program == "git" {
        return git::output(dir, args);
    }
    let output = Command::new(program)
        .current_dir(dir)
        .args(args)
        .output()
        .map_err(|e| format!("{program}: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().into());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().into())
}

async fn blocking_git_operation<T, F>(operation: F) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T> + Send + 'static,
{
    git::blocking(operation)
        .await
        .map_err(|error| AppError::Internal(anyhow::anyhow!(error)))?
}

async fn blocking_git_operation_for<T, F>(git_common_dir: String, operation: F) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T> + Send + 'static,
{
    git::blocking_for(Path::new(&git_common_dir), operation)
        .await
        .map_err(|error| AppError::Internal(anyhow::anyhow!(error)))?
}


#[derive(Debug, PartialEq)]
struct ParsedGitWorktree {
    path: String,
    branch: String,
    head_commit: String,
    is_main: bool,
}

fn normalized_path(value: &str) -> PathBuf {
    let path = PathBuf::from(value);
    if let Ok(canonical) = std::fs::canonicalize(&path) {
        return canonical;
    }

    let mut existing = path.as_path();
    let mut missing = Vec::new();
    while !existing.exists() {
        let Some(name) = existing.file_name() else {
            return path;
        };
        missing.push(name.to_os_string());
        let Some(parent) = existing.parent() else {
            return path;
        };
        existing = parent;
    }
    let Ok(mut normalized) = std::fs::canonicalize(existing) else {
        return path;
    };
    for component in missing.iter().rev() {
        normalized.push(component);
    }
    normalized
}

fn ensure_git_directory(directory: &Directory) -> Result<()> {
    if !directory.is_git
        || command_output(
            Path::new(&directory.path),
            "git",
            &["rev-parse", "--is-inside-work-tree"],
        )
        .is_err()
    {
        return Err(AppError::BadRequest(
            "directory is not a Git repository".into(),
        ));
    }
    Ok(())
}

fn git_ref_names(repository: &str, prefix: &str) -> Result<Vec<String>> {
    let output = command_output(
        Path::new(repository),
        "git",
        &["for-each-ref", "--format=%(refname)", prefix],
    )
    .map_err(AppError::BadRequest)?;
    let prefix = format!("{}/", prefix.trim_end_matches('/'));
    Ok(output
        .lines()
        .map(str::trim)
        .filter_map(|value| value.strip_prefix(&prefix).map(str::to_owned))
        .collect())
}

fn git_remote_names(repository: &str) -> Result<Vec<String>> {
    let output =
        command_output(Path::new(repository), "git", &["remote"]).map_err(AppError::BadRequest)?;
    Ok(output
        .lines()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .collect())
}

fn directory_branches(repository: &str) -> Result<GitBranches> {
    let mut local = git_ref_names(repository, "refs/heads")?;
    local.sort();
    let current = command_output(Path::new(repository), "git", &["branch", "--show-current"])
        .map_err(AppError::BadRequest)?;
    let remote_names =
        command_output(Path::new(repository), "git", &["remote"]).map_err(AppError::BadRequest)?;
    let mut remotes = Vec::new();
    for remote in remote_names
        .lines()
        .map(str::trim)
        .filter(|item| !item.is_empty())
    {
        let prefix = format!("refs/remotes/{remote}");
        let mut branches = git_ref_names(repository, &prefix)?
            .into_iter()
            .filter(|name| name != "HEAD")
            .collect::<Vec<_>>();
        branches.sort();
        remotes.push(GitRemoteBranches {
            name: remote.to_owned(),
            branches,
        });
    }
    remotes.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(GitBranches {
        current,
        local,
        remotes,
    })
}

fn git_worktrees(repository: &str) -> Result<Vec<ParsedGitWorktree>> {
    let output = command_output(
        Path::new(repository),
        "git",
        &["worktree", "list", "--porcelain"],
    )
    .map_err(AppError::BadRequest)?;
    Ok(parse_git_worktrees(&output))
}

fn git_history(repository: &str) -> Result<GitHistory> {
    let branch = command_output(Path::new(repository), "git", &["branch", "--show-current"])
        .map_err(AppError::BadRequest)?;
    let branch = if branch.is_empty() {
        "Detached HEAD".into()
    } else {
        branch
    };
    if command_output(
        Path::new(repository),
        "git",
        &["rev-parse", "--verify", "HEAD"],
    )
    .is_err()
    {
        return Ok(GitHistory {
            branch,
            commits: Vec::new(),
        });
    }
    let output = command_output(
        Path::new(repository),
        "git",
        &[
            "log",
            "-100",
            "--date=iso-strict",
            "--pretty=format:%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e",
        ],
    )
    .map_err(AppError::BadRequest)?;
    Ok(GitHistory {
        branch,
        commits: parse_git_history(&output),
    })
}

fn parse_git_history(output: &str) -> Vec<GitCommit> {
    output
        .split('\x1e')
        .filter_map(|record| {
            let mut fields = record.trim().splitn(5, '\x1f');
            Some(GitCommit {
                hash: fields.next()?.to_owned(),
                short_hash: fields.next()?.to_owned(),
                author: fields.next()?.to_owned(),
                authored_at: fields.next()?.to_owned(),
                subject: fields.next()?.to_owned(),
            })
        })
        .collect()
}

fn parse_git_worktrees(output: &str) -> Vec<ParsedGitWorktree> {
    output
        .split("\n\n")
        .enumerate()
        .filter_map(|(index, block)| {
            let mut path = None;
            let mut branch = None;
            let mut head_commit = None;
            let mut detached = false;
            for line in block.lines() {
                if let Some(value) = line.strip_prefix("worktree ") {
                    path = Some(value.to_owned());
                } else if let Some(value) = line.strip_prefix("HEAD ") {
                    head_commit = Some(value.chars().take(10).collect());
                } else if let Some(value) = line.strip_prefix("branch ") {
                    branch = Some(
                        value
                            .strip_prefix("refs/heads/")
                            .unwrap_or(value)
                            .to_owned(),
                    );
                } else if line == "detached" {
                    detached = true;
                }
            }
            Some(ParsedGitWorktree {
                path: path?,
                branch: branch.unwrap_or_else(|| {
                    if detached {
                        "detached HEAD".into()
                    } else {
                        "unknown".into()
                    }
                }),
                head_commit: head_commit.unwrap_or_default(),
                is_main: index == 0,
            })
        })
        .collect()
}

fn project_worktrees(
    directories: &[Directory],
    workspaces: &[Workspace],
    workspace_locations: &[WorkspaceLocation],
) -> Vec<GitWorktree> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for directory in directories.iter().filter(|item| item.is_git) {
        let Ok(items) = git_worktrees(&directory.path) else {
            continue;
        };
        for item in items {
            let path = normalized_path(&item.path);
            if !seen.insert(path.clone()) {
                continue;
            }
            let workspace = workspaces.iter().find(|stream| {
                stream.kind != "base"
                    && stream.status == "active"
                    && (workspace_locations.iter().any(|location| {
                        location.workspace_id == stream.id
                            && location.project_location_id == directory.id
                            && location
                                .checkout_path
                                .as_deref()
                                .is_some_and(|checkout_path| normalized_path(checkout_path) == path)
                    }) || normalized_path(&stream.checkout_path) == path)
            });
            result.push(GitWorktree {
                project_location_id: directory.id.clone(),
                location_name: directory.name.clone(),
                path: item.path,
                branch: item.branch,
                head_commit: item.head_commit,
                is_main: item.is_main
                    || directories
                        .iter()
                        .any(|candidate| normalized_path(&candidate.path) == path),
                workspace_id: workspace.map(|stream| stream.id.clone()),
                workspace_name: workspace.map(|stream| stream.name.clone()),
            });
        }
    }
    result
}

fn enrich_directory(directory: &mut Directory, workspace: Option<&str>) {
    let inspect_path = workspace.unwrap_or(&directory.path).to_owned();
    directory.checkout_path = workspace.map(str::to_owned);
    directory.is_git = command_output(
        Path::new(&inspect_path),
        "git",
        &["rev-parse", "--is-inside-work-tree"],
    )
    .is_ok();
    if !directory.is_git {
        directory.git_status = if !Path::new(&inspect_path).exists() {
            "missing"
        } else if directory.git_common_dir.is_some() {
            "broken"
        } else {
            "not_git"
        }
        .into();
        return;
    }
    directory.git_status = "ready".into();
    directory.branch = command_output(
        Path::new(&inspect_path),
        "git",
        &["branch", "--show-current"],
    )
    .ok();
    directory.remote_url = command_output(Path::new(&inspect_path), "git", &["remote"])
        .ok()
        .and_then(|remotes| remotes.lines().next().map(str::to_owned))
        .and_then(|remote| {
            command_output(
                Path::new(&inspect_path),
                "git",
                &["remote", "get-url", &remote],
            )
            .ok()
        });
    directory.head_commit = command_output(
        Path::new(&inspect_path),
        "git",
        &["rev-parse", "--short=10", "HEAD"],
    )
    .ok();
    directory.head_summary = command_output(
        Path::new(&inspect_path),
        "git",
        &["log", "-1", "--pretty=%s"],
    )
    .ok();
    directory.dirty = command_output(Path::new(&inspect_path), "git", &["status", "--porcelain"])
        .is_ok_and(|v| !v.is_empty());
}
fn slug(value: &str) -> String {
    let result = value
        .to_ascii_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>();
    let result = result
        .split('-')
        .filter(|v| !v.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if result.is_empty() {
        "workspace".into()
    } else {
        result.chars().take(32).collect()
    }
}

fn choose_shared_branch(
    locations: &[ProjectLocation],
    explicit: Option<&str>,
    label: &str,
) -> Result<String> {
    for attempt in 0..32 {
        let candidate = explicit.map(str::to_owned).unwrap_or_else(|| {
            let random = Uuid::new_v4().simple().to_string();
            format!("treefold/{}-{}", slug(label), &random[..8])
        });
        let mut conflict = false;
        for location in locations
            .iter()
            .filter(|location| location.git_status == "ready" || location.git_common_dir.is_some())
        {
            command_output(
                Path::new(&location.path),
                "git",
                &["check-ref-format", "--branch", &candidate],
            )
            .map_err(|_| AppError::BadRequest("invalid Workspace branch name".into()))?;
            if command_output(
                Path::new(&location.path),
                "git",
                &[
                    "show-ref",
                    "--verify",
                    "--quiet",
                    &format!("refs/heads/{candidate}"),
                ],
            )
            .is_ok()
            {
                conflict = true;
                break;
            }
        }
        if !conflict {
            return Ok(candidate);
        }
        if explicit.is_some() {
            return Err(AppError::BadRequest(
                "Workspace branch already exists in a Project location".into(),
            ));
        }
        if attempt == 31 {
            break;
        }
    }
    Err(AppError::BadRequest(
        "could not allocate a shared Workspace branch".into(),
    ))
}

fn read_only_workspace_location(
    workspace_id: &str,
    location: &ProjectLocation,
    timestamp: &str,
) -> WorkspaceLocation {
    WorkspaceLocation {
        id: id(),
        workspace_id: workspace_id.into(),
        project_location_id: location.id.clone(),
        location_name: location.name.clone(),
        source_path: location.path.clone(),
        access_mode: "read_only".into(),
        git_status: "not_git".into(),
        creation_error: None,
        worktree_id: None,
        checkout_path: None,
        branch: None,
        base_branch: None,
        start_commit: None,
        forked_from_commit: None,
        remote_name: None,
        remote_branch: None,
        branch_ownership: "none".into(),
        delivery_mode: "keep".into(),
        delivery_status: "not_applicable".into(),
        close_outcome: None,
        integrated_commit: None,
        closed_at: None,
        created_at: timestamp.into(),
        updated_at: timestamp.into(),
    }
}

#[allow(clippy::too_many_arguments)]
fn git_workspace_location(
    workspace_id: &str,
    location: &ProjectLocation,
    timestamp: &str,
    checkout_path: String,
    branch: String,
    base_branch: String,
    start_commit: String,
    forked_from_commit: Option<String>,
    remote_name: Option<String>,
    remote_branch: Option<String>,
    delivery_mode: String,
) -> WorkspaceLocation {
    WorkspaceLocation {
        id: id(),
        workspace_id: workspace_id.into(),
        project_location_id: location.id.clone(),
        location_name: location.name.clone(),
        source_path: location.path.clone(),
        access_mode: "read_write".into(),
        git_status: "ready".into(),
        creation_error: None,
        worktree_id: None,
        checkout_path: Some(checkout_path),
        branch: Some(branch),
        base_branch: Some(base_branch),
        start_commit: Some(start_commit),
        forked_from_commit,
        remote_name,
        remote_branch,
        branch_ownership: "managed".into(),
        delivery_mode,
        delivery_status: "active".into(),
        close_outcome: None,
        integrated_commit: None,
        closed_at: None,
        created_at: timestamp.into(),
        updated_at: timestamp.into(),
    }
}
