use super::*;

pub(super) async fn get_workspace_git_history(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<GitHistory>> {
    blocking_git_operation(move || {
        let repository = state.store.default_workspace_location(&id)?;
        Ok(Json(git_history(workspace_location_git_path(
            &repository,
        )?)?))
    })
    .await
}

pub(super) async fn get_project_location_git_history(
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

pub(super) async fn get_workspace_location_git_history(
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

pub(super) const MAX_DIFF_PATCH_BYTES: usize = 8 * 1024 * 1024;

pub(super) async fn compare_project_location_commits(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<GitDiffComparisonInput>,
) -> Result<Json<GitDiffComparison>> {
    blocking_git_operation(move || {
        let mut location = state.store.repository_as_directory(&id)?;
        refresh_location_observation(&mut location)?;
        ensure_location_ready(&location)?;
        Ok(Json(compare_git_commits(
            &location.path,
            &location.name,
            &input,
            MAX_DIFF_PATCH_BYTES,
        )?))
    })
    .await
}

pub(super) async fn compare_workspace_location_commits(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<GitDiffComparisonInput>,
) -> Result<Json<GitDiffComparison>> {
    blocking_git_operation(move || {
        let location = state.store.workspace_location(&id)?;
        let path = workspace_location_git_path(&location)?;
        Ok(Json(compare_git_commits(
            path,
            &location.location_name,
            &input,
            MAX_DIFF_PATCH_BYTES,
        )?))
    })
    .await
}

pub(super) async fn get_project_location_git_status(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<GitStatus>> {
    blocking_git_operation(move || {
        let mut location = state.store.repository_as_directory(&id)?;
        refresh_location_observation(&mut location)?;
        ensure_location_ready(&location)?;
        Ok(Json(git_status(&location.path)?))
    })
    .await
}

pub(super) async fn get_workspace_location_git_status(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<GitStatus>> {
    blocking_git_operation(move || {
        let location = state.store.workspace_location(&id)?;
        Ok(Json(git_status(workspace_location_git_path(&location)?)?))
    })
    .await
}

pub(super) async fn project_location_git_diff(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<GitDiffRequest>,
) -> Result<Json<GitDiffComparison>> {
    blocking_git_operation(move || {
        let mut location = state.store.repository_as_directory(&id)?;
        refresh_location_observation(&mut location)?;
        ensure_location_ready(&location)?;
        Ok(Json(git_diff(&location.path, &location.name, &input)?))
    })
    .await
}

pub(super) async fn workspace_location_git_diff(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<GitDiffRequest>,
) -> Result<Json<GitDiffComparison>> {
    blocking_git_operation(move || {
        let location = state.store.workspace_location(&id)?;
        let path = workspace_location_git_path(&location)?;
        Ok(Json(git_diff(path, &location.location_name, &input)?))
    })
    .await
}

pub(super) async fn project_location_stage(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<GitPathsInput>,
) -> Result<Json<GitStatus>> {
    mutate_project_paths(state, id, input, true).await
}

pub(super) async fn project_location_unstage(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<GitPathsInput>,
) -> Result<Json<GitStatus>> {
    mutate_project_paths(state, id, input, false).await
}

pub(super) async fn workspace_location_stage(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<GitPathsInput>,
) -> Result<Json<GitStatus>> {
    mutate_workspace_paths(state, id, input, true).await
}

pub(super) async fn workspace_location_unstage(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<GitPathsInput>,
) -> Result<Json<GitStatus>> {
    mutate_workspace_paths(state, id, input, false).await
}

pub(super) async fn project_location_commit(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<GitCommitInput>,
) -> Result<Json<GitCommitResult>> {
    let mut location = state.store.repository_as_directory(&id)?;
    refresh_location_observation(&mut location)?;
    ensure_location_ready(&location)?;
    let path = location.path.clone();
    let common = location
        .git_common_dir
        .clone()
        .ok_or_else(|| AppError::BadRequest("Repository has no Git common directory".into()))?;
    blocking_git_operation_for(common, move || commit_repository(&path, input)).await
}

pub(super) async fn workspace_location_commit(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<GitCommitInput>,
) -> Result<Json<GitCommitResult>> {
    let location = state.store.workspace_location(&id)?;
    let path = workspace_location_git_path(&location)?.to_owned();
    let common = state
        .store
        .repository(&location.project_location_id)?
        .git_common_dir;
    blocking_git_operation_for(common, move || commit_repository(&path, input)).await
}

async fn mutate_project_paths(
    state: AppState,
    id: String,
    input: GitPathsInput,
    stage: bool,
) -> Result<Json<GitStatus>> {
    let mut location = state.store.repository_as_directory(&id)?;
    refresh_location_observation(&mut location)?;
    ensure_location_ready(&location)?;
    let path = location.path.clone();
    let common = location
        .git_common_dir
        .clone()
        .ok_or_else(|| AppError::BadRequest("Repository has no Git common directory".into()))?;
    blocking_git_operation_for(common, move || {
        mutate_paths(&path, &input.paths, stage)?;
        Ok(Json(git_status(&path)?))
    })
    .await
}

async fn mutate_workspace_paths(
    state: AppState,
    id: String,
    input: GitPathsInput,
    stage: bool,
) -> Result<Json<GitStatus>> {
    let location = state.store.workspace_location(&id)?;
    let path = workspace_location_git_path(&location)?.to_owned();
    let common = state
        .store
        .repository(&location.project_location_id)?
        .git_common_dir;
    blocking_git_operation_for(common, move || {
        mutate_paths(&path, &input.paths, stage)?;
        Ok(Json(git_status(&path)?))
    })
    .await
}

fn mutate_paths(repository: &str, paths: &[String], stage: bool) -> Result<()> {
    if paths.is_empty() {
        return Err(AppError::BadRequest("paths must not be empty".into()));
    }
    let has_head = command_output(
        Path::new(repository),
        "git",
        &["rev-parse", "--verify", "HEAD"],
    )
    .is_ok();
    let mut args = if stage {
        vec!["add", "--"]
    } else if has_head {
        vec!["restore", "--staged", "--"]
    } else {
        vec!["rm", "--cached", "--ignore-unmatch", "--"]
    };
    args.extend(paths.iter().map(String::as_str));
    command_output(Path::new(repository), "git", &args).map_err(AppError::BadRequest)?;
    Ok(())
}

fn git_status(repository: &str) -> Result<GitStatus> {
    let path = Path::new(repository);
    let branch =
        command_output(path, "git", &["branch", "--show-current"]).map_err(AppError::BadRequest)?;
    let head = command_output(path, "git", &["rev-parse", "HEAD"]).ok();
    let status_output = Command::new("git")
        .current_dir(path)
        .args(["status", "--porcelain=v1", "-z"])
        .output()
        .map_err(|error| AppError::BadRequest(format!("git: {error}")))?;
    if !status_output.status.success() {
        return Err(AppError::BadRequest(
            String::from_utf8_lossy(&status_output.stderr).trim().into(),
        ));
    }
    let output = String::from_utf8_lossy(&status_output.stdout).into_owned();
    let mut files = Vec::new();
    let mut records = output.split('\0').filter(|record| !record.is_empty());
    while let Some(record) = records.next() {
        let mut chars = record.chars();
        let index = chars.next().unwrap_or(' ');
        let worktree = chars.next().unwrap_or(' ');
        let path = record.get(3..).unwrap_or("").to_owned();
        let old_path = if index == 'R' || index == 'C' || worktree == 'R' || worktree == 'C' {
            records.next().map(str::to_owned)
        } else {
            None
        };
        let has_staged_changes = index != ' ' && index != '?';
        let has_unstaged_changes = worktree != ' ' || index == '?';
        let status = if index == '?' || worktree == '?' {
            "untracked"
        } else if index == 'U' || worktree == 'U' {
            "conflicted"
        } else if old_path.is_some() || index == 'R' || worktree == 'R' {
            "renamed"
        } else if index == 'A' || worktree == 'A' {
            "added"
        } else if index == 'D' || worktree == 'D' {
            "deleted"
        } else {
            "modified"
        };
        let (additions, deletions, binary) = change_stats(
            Path::new(repository),
            &path,
            has_staged_changes,
            has_unstaged_changes,
            status == "untracked",
        );
        files.push(GitChangeFile {
            path,
            old_path,
            status: status.into(),
            staged: has_staged_changes,
            has_staged_changes,
            has_unstaged_changes,
            additions,
            deletions,
            binary,
        });
    }
    let staged_count = files.iter().filter(|file| file.has_staged_changes).count();
    let unstaged_count = files
        .iter()
        .filter(|file| file.has_unstaged_changes)
        .count();
    let snapshot = format!("{}|{output}", head.as_deref().unwrap_or(""));
    Ok(GitStatus {
        branch: if branch.is_empty() {
            "Detached HEAD".into()
        } else {
            branch
        },
        head,
        files,
        staged_count,
        unstaged_count,
        snapshot,
    })
}

fn commit_repository(repository: &str, input: GitCommitInput) -> Result<Json<GitCommitResult>> {
    let current = git_status(repository)?;
    if input.message.trim().is_empty() {
        return Err(AppError::BadRequest(
            "Commit message must not be empty".into(),
        ));
    }
    if current.snapshot != input.expected_snapshot {
        return Err(AppError::api(
            StatusCode::CONFLICT,
            "GIT_STATE_STALE",
            "Git state changed; refresh Changes before committing",
        ));
    }
    if current.staged_count == 0 {
        return Err(AppError::BadRequest("No staged changes to commit".into()));
    }
    command_output(
        Path::new(repository),
        "git",
        &["commit", "-m", input.message.trim()],
    )
    .map_err(|error| AppError::BadRequest(error))?;
    let hash = command_output(Path::new(repository), "git", &["rev-parse", "HEAD"])
        .map_err(AppError::BadRequest)?;
    Ok(Json(GitCommitResult {
        hash,
        status: git_status(repository)?,
    }))
}

fn git_diff(repository: &str, name: &str, input: &GitDiffRequest) -> Result<GitDiffComparison> {
    let path = Path::new(repository);
    if let GitDiffRequest::Unstaged { path: Some(file) } = input
        && command_output(path, "git", &["ls-files", "--error-unmatch", "--", file]).is_err()
    {
        let output = Command::new("git")
            .current_dir(path)
            .args([
                "diff",
                "--no-color",
                "--no-index",
                "--unified=3",
                "--",
                "/dev/null",
                file,
            ])
            .output()
            .map_err(|error| AppError::BadRequest(format!("git: {error}")))?;
        if !output.status.success() && output.status.code() != Some(1) {
            return Err(AppError::BadRequest(
                String::from_utf8_lossy(&output.stderr).trim().into(),
            ));
        }
        let patch = String::from_utf8_lossy(&output.stdout).into_owned();
        if patch.len() > MAX_DIFF_PATCH_BYTES {
            return Err(AppError::api(
                StatusCode::PAYLOAD_TOO_LARGE,
                "DIFF_TOO_LARGE",
                "Diff exceeds the response limit",
            ));
        }
        return Ok(GitDiffComparison {
            repository: name.into(),
            resolved_base: "INDEX".into(),
            resolved_head: "WORKTREE".into(),
            commit_count: 1,
            patch,
        });
    }
    let (args, base, head, commit_count) = match input {
        GitDiffRequest::Staged { .. } => (
            vec![
                "diff",
                "--no-color",
                "--find-renames",
                "--unified=3",
                "--cached",
            ],
            "HEAD".into(),
            "INDEX".into(),
            1,
        ),
        GitDiffRequest::Unstaged { .. } => (
            vec!["diff", "--no-color", "--find-renames", "--unified=3"],
            "INDEX".into(),
            "WORKTREE".into(),
            1,
        ),
        GitDiffRequest::Commit {
            start_commit,
            end_commit,
            commit_count,
            path: file,
        } => {
            let mut comparison = compare_git_commits(
                repository,
                name,
                &GitDiffComparisonInput {
                    start_commit: start_commit.clone(),
                    end_commit: end_commit.clone(),
                    commit_count: *commit_count,
                },
                MAX_DIFF_PATCH_BYTES,
            )?;
            if let Some(file) = file {
                comparison.patch = command_output(
                    path,
                    "git",
                    &[
                        "diff",
                        "--no-color",
                        "--find-renames",
                        "--unified=3",
                        &comparison.resolved_base,
                        &comparison.resolved_head,
                        "--",
                        file,
                    ],
                )
                .map_err(AppError::BadRequest)?;
            }
            return Ok(comparison);
        }
    };
    let mut args = args;
    if let Some(file) = match input {
        GitDiffRequest::Staged { path } | GitDiffRequest::Unstaged { path } => path,
        _ => &None,
    } {
        args.push("--");
        args.push(file.as_str());
    }
    let patch = command_output(path, "git", &args).map_err(|error| {
        if error.contains("diff exceeds") {
            AppError::api(StatusCode::PAYLOAD_TOO_LARGE, "DIFF_TOO_LARGE", error)
        } else {
            AppError::BadRequest(error)
        }
    })?;
    if patch.len() > MAX_DIFF_PATCH_BYTES {
        return Err(AppError::api(
            StatusCode::PAYLOAD_TOO_LARGE,
            "DIFF_TOO_LARGE",
            "Diff exceeds the response limit",
        ));
    }
    Ok(GitDiffComparison {
        repository: name.into(),
        resolved_base: base,
        resolved_head: head,
        commit_count,
        patch,
    })
}

fn change_stats(
    repository: &Path,
    file: &str,
    staged: bool,
    unstaged: bool,
    untracked: bool,
) -> (usize, usize, bool) {
    if untracked {
        return std::fs::read(repository.join(file))
            .map(|bytes| {
                let binary = bytes.contains(&0);
                (
                    if binary {
                        0
                    } else {
                        bytes.split(|byte| *byte == b'\n').count().saturating_sub(1)
                    },
                    0,
                    binary,
                )
            })
            .unwrap_or((0, 0, false));
    }
    let mut additions = 0;
    let mut deletions = 0;
    let mut binary = false;
    for cached in [staged, false]
        .into_iter()
        .filter(|cached| *cached || unstaged)
    {
        let mut args = vec!["diff", "--numstat"];
        if cached {
            args.push("--cached");
        }
        args.extend(["--", file]);
        if let Ok(output) = command_output(repository, "git", &args) {
            for line in output.lines() {
                let mut fields = line.split('\t');
                match (fields.next(), fields.next()) {
                    (Some("-"), Some("-")) => binary = true,
                    (Some(added), Some(deleted)) => {
                        additions += added.parse::<usize>().unwrap_or(0);
                        deletions += deleted.parse::<usize>().unwrap_or(0);
                    }
                    _ => {}
                }
            }
        }
        if !cached {
            break;
        }
    }
    (additions, deletions, binary)
}

pub(super) async fn pull_project_location(
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
        Ok(Json(
            sync_project_location(&location, &project, "pull").await?,
        ))
    })
    .await
}

pub(super) async fn push_project_location(
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
        Ok(Json(
            sync_project_location(&location, &project, "push").await?,
        ))
    })
    .await
}

pub(super) async fn pull_workspace_location(
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

pub(super) async fn push_workspace_location(
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

pub(super) async fn pull_all_project(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Vec<GitSyncItemResult>>> {
    sync_all_project_locations(&state, &id, "pull").await
}
pub(super) async fn push_all_project(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Vec<GitSyncItemResult>>> {
    sync_all_project_locations(&state, &id, "push").await
}
pub(super) async fn sync_all_project_locations(
    state: &AppState,
    project_id: &str,
    action: &str,
) -> Result<Json<Vec<GitSyncItemResult>>> {
    let project = state.store.project(project_id)?;
    ensure_active_project(&project)?;
    let mut results = Vec::new();
    for repository in state.store.repositories(project_id)? {
        let location = state.store.repository_as_directory(&repository.id)?;
        if location.git_status == "not_git" {
            results.push(GitSyncItemResult {
                project_location_id: location.id,
                workspace_location_id: None,
                location_name: location.name,
                status: "skipped".into(),
                result: None,
                error: None,
            });
            continue;
        }
        if location.preferred_remote_name.is_none() {
            results.push(GitSyncItemResult {
                project_location_id: location.id,
                workspace_location_id: None,
                location_name: location.name,
                status: "skipped".into(),
                result: None,
                error: Some("remote is not configured".into()),
            });
            continue;
        }
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

pub(super) async fn pull_all_workspace(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Vec<GitSyncItemResult>>> {
    sync_all_workspace_locations(&state, &id, "pull").await
}
pub(super) async fn push_all_workspace(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Vec<GitSyncItemResult>>> {
    sync_all_workspace_locations(&state, &id, "push").await
}
pub(super) async fn sync_all_workspace_locations(
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

pub(super) fn ensure_location_ready(location: &ProjectLocation) -> Result<()> {
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

pub(super) async fn sync_project_location(
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

pub(super) fn workspace_location_git_path(location: &WorkspaceLocation) -> Result<&str> {
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

pub(super) async fn sync_workspace_location(
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

pub(super) fn remote_branch_head(
    repository: &str,
    remote: &str,
    branch: &str,
) -> Result<Option<String>> {
    let output = command_output(
        Path::new(repository),
        "git",
        &[
            "ls-remote",
            "--heads",
            remote,
            &format!("refs/heads/{branch}"),
        ],
    )
    .map_err(AppError::BadRequest)?;
    Ok(output
        .split_whitespace()
        .next()
        .filter(|value| !value.is_empty())
        .map(str::to_owned))
}

pub(super) async fn archive_workspace(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Workspace>> {
    let workspace = state.store.workspace(&id)?;
    state.store.archive_workspace(&id)?;
    if workspace.kind == "fork"
        && let Some(todo) = state.store.todo_for_fork(&id)?
        && matches!(todo.status.as_str(), "in_progress" | "blocked")
    {
        state.store.update_todo(&todo.id, "pending")?;
    }
    for mut session in state.store.sessions(&id)? {
        capture_codex_session_id(&state.store, &mut session)?;
        let _ = state
            .terminals
            .stop_existing(&session.amux_workspace_name, &session.amux_process_name)
            .await;
        state.store.set_session_status(&session.id, "stopped")?;
    }
    Ok(Json(state.store.workspace(&id)?))
}

pub(super) async fn pull_project(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<GitSyncResult>> {
    let project = state.store.project(&id)?;
    let directory = state.store.directory(&project.primary_directory_id)?;
    ensure_git_directory(&directory)?;
    let repository_root = repository_root_for_directory(&state, &project.primary_directory_id)?;
    ensure_clean_workspace(&repository_root, "Project source checkout")?;
    ensure_checked_out_branch(
        &repository_root,
        &project.default_target_branch,
        "Project source checkout",
    )?;
    let remote = project
        .preferred_remote
        .ok_or_else(|| AppError::BadRequest("Project has no preferred remote".into()))?;
    let remote_branch = project.default_target_branch.clone();
    let before_head = git_head(&repository_root)?;
    fetch_remote_branch_async(&repository_root, &remote, &remote_branch).await?;
    git::output_async(
        Path::new(&repository_root),
        &["merge", "--ff-only", "FETCH_HEAD"],
    )
    .await
    .map_err(|error| {
        AppError::BadRequest(format!(
            "Project target cannot fast-forward from {remote}/{remote_branch}: {error}"
        ))
    })?;
    let after_head = git_head(&repository_root)?;
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

pub(super) async fn push_project(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<GitSyncResult>> {
    let project = state.store.project(&id)?;
    let directory = state.store.directory(&project.primary_directory_id)?;
    ensure_git_directory(&directory)?;
    let repository_root = repository_root_for_directory(&state, &project.primary_directory_id)?;
    let remote = project
        .preferred_remote
        .ok_or_else(|| AppError::BadRequest("Project has no preferred remote".into()))?;
    let remote_branch = project.default_target_branch.clone();
    let before_head = command_output(
        Path::new(&repository_root),
        "git",
        &["rev-parse", &project.default_target_branch],
    )
    .map_err(AppError::BadRequest)?;
    let refspec = format!("{}:{remote_branch}", project.default_target_branch);
    git::output_async(Path::new(&repository_root), &["push", &remote, &refspec])
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

pub(super) async fn pull_workspace(
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

pub(super) async fn push_workspace(
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

pub(super) fn ensure_active_workspace(workspace: &Workspace) -> Result<()> {
    if workspace.status != "active" || workspace.kind == "base" {
        return Err(AppError::BadRequest("Workspace is not active".into()));
    }
    Ok(())
}

pub(super) fn workspace_upstream(workspace: &Workspace) -> Result<(String, String)> {
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

pub(super) fn fetch_remote_branch(repository: &str, remote: &str, branch: &str) -> Result<()> {
    command_output(
        Path::new(repository),
        "git",
        &["fetch", "--no-tags", remote, branch],
    )
    .map_err(AppError::BadRequest)?;
    Ok(())
}

pub(super) async fn fetch_remote_branch_async(
    repository: &str,
    remote: &str,
    branch: &str,
) -> Result<()> {
    git::output_async(
        Path::new(repository),
        &["fetch", "--no-tags", remote, branch],
    )
    .await
    .map_err(AppError::BadRequest)?;
    Ok(())
}

pub(super) fn sync_result(
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

pub(super) async fn get_git_operations(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Vec<GitOperationRecord>>> {
    state.store.workspace(&id)?;
    Ok(Json(git_operation_history(&state, &id)?))
}

pub(super) fn git_operation_history(state: &AppState, id: &str) -> Result<Vec<GitOperationRecord>> {
    let mut records = Vec::new();
    if let Some(operation) = state.store.delivery_operation(id)? {
        records.push(GitOperationRecord {
            id: format!("delivery:{}", operation.workspace_id),
            kind: "delivery".into(),
            action: operation.code_action,
            status: if operation.phase == "archived" {
                "completed".into()
            } else if operation.error.is_empty() {
                "active".into()
            } else {
                "failed".into()
            },
            before_head: operation.before_head,
            target_head: operation.target_head,
            result_head: operation.integrated_commit,
            recovery_ref: None,
            error: operation.error,
            started_at: operation.started_at,
            updated_at: operation.updated_at,
        });
    }
    records.extend(
        state
            .store
            .parent_operations(id)?
            .into_iter()
            .map(|operation| GitOperationRecord {
                id: operation.id,
                kind: "parent".into(),
                action: format!("{}_{}", operation.direction, operation.strategy),
                status: operation.status,
                before_head: operation.before_head,
                target_head: operation.parent_head,
                result_head: operation.result_head,
                recovery_ref: Some(operation.recovery_ref),
                error: operation.error,
                started_at: operation.started_at,
                updated_at: operation.updated_at,
            }),
    );
    records.extend(
        state
            .store
            .rebase_operations(id)?
            .into_iter()
            .map(|operation| GitOperationRecord {
                id: operation.id,
                kind: "rebase".into(),
                action: "onto_target".into(),
                status: operation.status,
                before_head: operation.before_head,
                target_head: operation.target_head,
                result_head: operation.rebased_head,
                recovery_ref: Some(operation.recovery_ref),
                error: operation.error,
                started_at: operation.started_at,
                updated_at: operation.updated_at,
            }),
    );
    records.extend(
        state
            .store
            .reset_operations(id)?
            .into_iter()
            .map(|operation| GitOperationRecord {
                id: operation.id,
                kind: "reset".into(),
                action: operation.mode,
                status: operation.status,
                before_head: operation.before_head,
                target_head: operation.target_head,
                result_head: operation.result_head,
                recovery_ref: Some(operation.recovery_ref),
                error: operation.error,
                started_at: operation.started_at,
                updated_at: operation.updated_at,
            }),
    );
    let mut seen = HashSet::new();
    records.retain(|record| seen.insert(record.id.clone()));
    records.sort_by(|left, right| right.started_at.cmp(&left.started_at));
    Ok(records)
}
pub(super) fn id() -> String {
    Uuid::new_v4().simple().to_string()
}
pub(super) fn trimmed(value: Option<String>) -> Option<String> {
    value.map(|v| v.trim().to_owned())
}
pub(super) fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}
pub(super) fn basename(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or("workspace")
        .to_owned()
}
pub(super) fn inspect_path(value: &str) -> Result<(String, bool)> {
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

pub(super) fn refresh_location_observation(location: &mut ProjectLocation) -> Result<()> {
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
    ) && !repository_identity_matches(expected, observed)
    {
        location.git_status = "mismatch".into();
        return Ok(());
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

pub(super) fn repository_identity_matches(expected: &str, observed: &str) -> bool {
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
pub(super) fn command_output(
    dir: &Path,
    program: &str,
    args: &[&str],
) -> std::result::Result<String, String> {
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

pub(super) async fn blocking_git_operation<T, F>(operation: F) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T> + Send + 'static,
{
    git::blocking(operation)
        .await
        .map_err(|error| AppError::Internal(anyhow::anyhow!(error)))?
}

pub(super) async fn blocking_git_operation_for<T, F>(
    git_common_dir: String,
    operation: F,
) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T> + Send + 'static,
{
    git::blocking_for(Path::new(&git_common_dir), operation)
        .await
        .map_err(|error| AppError::Internal(anyhow::anyhow!(error)))?
}

#[derive(Debug, PartialEq)]
pub(super) struct ParsedGitWorktree {
    pub(super) path: String,
    pub(super) branch: String,
    pub(super) head_commit: String,
    pub(super) is_main: bool,
}

pub(super) fn normalized_path(value: &str) -> PathBuf {
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

pub(super) fn ensure_git_directory(directory: &Directory) -> Result<()> {
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

pub(super) fn git_ref_names(repository: &str, prefix: &str) -> Result<Vec<String>> {
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

pub(super) fn git_remote_names(repository: &str) -> Result<Vec<String>> {
    let output =
        command_output(Path::new(repository), "git", &["remote"]).map_err(AppError::BadRequest)?;
    Ok(output
        .lines()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .collect())
}

pub(super) fn directory_branches(repository: &str) -> Result<GitBranches> {
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

pub(super) fn git_worktrees(repository: &str) -> Result<Vec<ParsedGitWorktree>> {
    let output = command_output(
        Path::new(repository),
        "git",
        &["worktree", "list", "--porcelain"],
    )
    .map_err(AppError::BadRequest)?;
    Ok(parse_git_worktrees(&output))
}

pub(super) fn git_history(repository: &str) -> Result<GitHistory> {
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

pub(super) fn compare_git_commits(
    repository: &str,
    repository_name: &str,
    input: &GitDiffComparisonInput,
    max_patch_bytes: usize,
) -> Result<GitDiffComparison> {
    if input.commit_count == 0 {
        return Err(AppError::BadRequest(
            "commit_count must be greater than zero".into(),
        ));
    }
    let repository_path = Path::new(repository);
    let start = resolve_full_commit(repository_path, &input.start_commit)?;
    let head = resolve_full_commit(repository_path, &input.end_commit)?;
    let parents = command_output(
        repository_path,
        "git",
        &["rev-list", "--parents", "-n", "1", &start],
    )
    .map_err(AppError::BadRequest)?;
    let base = parents
        .split_whitespace()
        .nth(1)
        .map(str::to_owned)
        .map(Ok)
        .unwrap_or_else(|| empty_tree_hash(repository_path))?;
    let output = Command::new("git")
        .current_dir(repository_path)
        .args([
            "diff",
            "--no-color",
            "--find-renames",
            "--unified=3",
            &base,
            &head,
        ])
        .output()
        .map_err(|error| AppError::BadRequest(format!("git: {error}")))?;
    if !output.status.success() {
        return Err(AppError::BadRequest(
            String::from_utf8_lossy(&output.stderr).trim().into(),
        ));
    }
    if output.stdout.len() > max_patch_bytes {
        return Err(AppError::api(
            StatusCode::PAYLOAD_TOO_LARGE,
            "DIFF_TOO_LARGE",
            format!("Diff exceeds the {max_patch_bytes} byte response limit"),
        ));
    }
    Ok(GitDiffComparison {
        repository: repository_name.to_owned(),
        resolved_base: base,
        resolved_head: head,
        commit_count: input.commit_count,
        patch: String::from_utf8_lossy(&output.stdout).into_owned(),
    })
}

pub(super) fn resolve_full_commit(repository: &Path, value: &str) -> Result<String> {
    let object_format = command_output(repository, "git", &["rev-parse", "--show-object-format"])
        .map_err(AppError::BadRequest)?;
    let expected_length = match object_format.as_str() {
        "sha1" => 40,
        "sha256" => 64,
        _ => {
            return Err(AppError::BadRequest(format!(
                "unsupported Git object format: {object_format}"
            )));
        }
    };
    if value.len() != expected_length || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(AppError::BadRequest(
            "start_commit and end_commit must be full commit hashes".into(),
        ));
    }
    let resolved = command_output(
        repository,
        "git",
        &["rev-parse", "--verify", &format!("{value}^{{commit}}")],
    )
    .map_err(|_| AppError::BadRequest("commit does not exist in this repository".into()))?;
    if !resolved.eq_ignore_ascii_case(value) {
        return Err(AppError::BadRequest(
            "start_commit and end_commit must be full commit hashes".into(),
        ));
    }
    Ok(resolved)
}

pub(super) fn empty_tree_hash(repository: &Path) -> Result<String> {
    let mut child = Command::new("git")
        .current_dir(repository)
        .args(["hash-object", "-t", "tree", "--stdin"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|error| AppError::BadRequest(format!("git: {error}")))?;
    drop(child.stdin.take());
    let output = child
        .wait_with_output()
        .map_err(|error| AppError::BadRequest(format!("git: {error}")))?;
    if !output.status.success() {
        return Err(AppError::BadRequest(
            String::from_utf8_lossy(&output.stderr).trim().into(),
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().into())
}

pub(super) fn parse_git_history(output: &str) -> Vec<GitCommit> {
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

pub(super) fn parse_git_worktrees(output: &str) -> Vec<ParsedGitWorktree> {
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

pub(super) fn project_worktrees(
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

pub(super) fn enrich_directory(directory: &mut Directory, workspace: Option<&str>) {
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
pub(super) fn slug(value: &str) -> String {
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

pub(super) fn choose_shared_branch(
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

pub(super) fn read_only_workspace_location(
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
pub(super) fn git_workspace_location(
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

#[cfg(test)]
mod git_diff_comparison_tests {
    use std::{fs, path::Path, process::Command};

    use tempfile::TempDir;

    use super::{
        GitCommitInput, GitDiffComparisonInput, commit_repository, compare_git_commits, git_status,
        mutate_paths,
    };
    use crate::error::AppError;

    struct TestRepository {
        directory: TempDir,
    }

    impl TestRepository {
        fn new() -> Self {
            let directory = tempfile::tempdir().expect("create temporary repository");
            run(directory.path(), &["init", "-b", "main"]);
            run(directory.path(), &["config", "user.name", "Treefold Test"]);
            run(
                directory.path(),
                &["config", "user.email", "treefold@example.test"],
            );
            Self { directory }
        }

        fn path(&self) -> &Path {
            self.directory.path()
        }

        fn write(&self, path: &str, contents: &[u8]) {
            let target = self.path().join(path);
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).expect("create test file parent");
            }
            fs::write(target, contents).expect("write test file");
        }

        fn commit(&self, message: &str) -> String {
            run(self.path(), &["add", "-A"]);
            run(self.path(), &["commit", "--allow-empty", "-m", message]);
            output(self.path(), &["rev-parse", "HEAD"])
        }
    }

    fn run(path: &Path, args: &[&str]) {
        let output = Command::new("git")
            .current_dir(path)
            .args(args)
            .output()
            .expect("run git command");
        assert!(
            output.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn output(path: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .current_dir(path)
            .args(args)
            .output()
            .expect("run git command");
        assert!(
            output.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout)
            .expect("UTF-8 git output")
            .trim()
            .into()
    }

    fn compare(
        repository: &TestRepository,
        start: &str,
        end: &str,
        count: usize,
    ) -> super::GitDiffComparison {
        compare_git_commits(
            repository.path().to_str().expect("UTF-8 path"),
            "test-repository",
            &GitDiffComparisonInput {
                start_commit: start.into(),
                end_commit: end.into(),
                commit_count: count,
            },
            8 * 1024 * 1024,
        )
        .expect("compare commits")
    }

    #[test]
    fn compares_root_normal_range_rename_binary_and_empty_commits() {
        let repository = TestRepository::new();
        repository.write(
            "README.md",
            b"one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n",
        );
        let root = repository.commit("root");
        let root_diff = compare(&repository, &root, &root, 1);
        assert!(root_diff.patch.contains("new file mode"));
        assert_ne!(root_diff.resolved_base, root);

        repository.write(
            "README.md",
            b"one\ntwo changed\nthree\nfour\nfive\nsix\nseven\neight\n",
        );
        let normal = repository.commit("normal");
        let normal_diff = compare(&repository, &normal, &normal, 1);
        assert!(normal_diff.patch.contains("two changed"));

        run(repository.path(), &["mv", "README.md", "docs.md"]);
        let renamed = repository.commit("rename");
        let rename_diff = compare(&repository, &renamed, &renamed, 1);
        assert!(rename_diff.patch.contains("rename from README.md"));
        assert!(rename_diff.patch.contains("rename to docs.md"));

        repository.write("asset.bin", &[0, 1, 2, 0, 255]);
        let binary = repository.commit("binary");
        let binary_diff = compare(&repository, &binary, &binary, 1);
        assert!(binary_diff.patch.contains("Binary files"));

        let range = compare(&repository, &normal, &binary, 3);
        assert_eq!(range.commit_count, 3);
        assert!(range.patch.contains("docs.md"));
        assert!(range.patch.contains("asset.bin"));

        let empty = repository.commit("empty");
        assert!(compare(&repository, &empty, &empty, 1).patch.is_empty());
    }

    #[test]
    fn merge_comparison_uses_the_first_parent() {
        let repository = TestRepository::new();
        repository.write("base.txt", b"base\n");
        repository.commit("root");
        run(repository.path(), &["checkout", "-b", "feature"]);
        repository.write("feature.txt", b"feature\n");
        repository.commit("feature");
        run(repository.path(), &["checkout", "main"]);
        repository.write("main.txt", b"main\n");
        repository.commit("main");
        run(
            repository.path(),
            &["merge", "--no-ff", "feature", "-m", "merge"],
        );
        let merge = output(repository.path(), &["rev-parse", "HEAD"]);
        let first_parent = output(repository.path(), &["rev-parse", "HEAD^1"]);
        let result = compare(&repository, &merge, &merge, 1);
        assert_eq!(result.resolved_base, first_parent);
        assert!(result.patch.contains("feature.txt"));
        assert!(!result.patch.contains("main.txt"));
    }

    #[test]
    fn rejects_invalid_hashes_and_oversized_patches() {
        let repository = TestRepository::new();
        repository.write("large.txt", b"a large change\n");
        let commit = repository.commit("root");
        let invalid = compare_git_commits(
            repository.path().to_str().expect("UTF-8 path"),
            "test-repository",
            &GitDiffComparisonInput {
                start_commit: commit[..10].into(),
                end_commit: commit.clone(),
                commit_count: 1,
            },
            1024,
        );
        assert!(matches!(invalid, Err(AppError::BadRequest(_))));

        let oversized = compare_git_commits(
            repository.path().to_str().expect("UTF-8 path"),
            "test-repository",
            &GitDiffComparisonInput {
                start_commit: commit.clone(),
                end_commit: commit,
                commit_count: 1,
            },
            1,
        );
        assert!(matches!(
            oversized,
            Err(AppError::Api {
                code: "DIFF_TOO_LARGE",
                ..
            })
        ));
    }

    #[test]
    fn reads_status_stages_selected_paths_and_rejects_stale_commit() {
        let repository = TestRepository::new();
        repository.write("tracked.txt", b"one\n");
        repository.commit("root");
        repository.write("tracked.txt", b"two\n");
        repository.write("new.txt", b"new\n");
        let path = repository.path().to_str().expect("UTF-8 path");
        let status = git_status(path).expect("read status");
        assert_eq!(status.files.len(), 2);
        assert_eq!(status.unstaged_count, 2);
        mutate_paths(path, &["tracked.txt".into()], true).expect("stage tracked file");
        let staged = git_status(path).expect("read staged status");
        assert_eq!(staged.staged_count, 1);
        assert_eq!(staged.unstaged_count, 1);
        let stale = commit_repository(
            path,
            GitCommitInput {
                message: "commit".into(),
                expected_snapshot: "wrong".into(),
            },
        );
        assert!(matches!(
            stale,
            Err(AppError::Api {
                code: "GIT_STATE_STALE",
                ..
            })
        ));
        let result = commit_repository(
            path,
            GitCommitInput {
                message: "commit".into(),
                expected_snapshot: staged.snapshot,
            },
        )
        .expect("commit staged file");
        assert_eq!(result.0.status.staged_count, 0);
        assert_eq!(result.0.hash.len(), 40);
    }
}
