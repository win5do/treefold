//! Linear history rewriting. Prepare immutable objects first and atomically
//! publish the replacement plus recovery refs; never reset the index/worktree.
use super::{
    ApiJson, AppError, AppState, AxumPath, Json, Result, State, StatusCode,
    blocking_git_operation_for, ensure_location_ready, git_head, git_history, git_is_ancestor,
    git_operation_in_progress, new_id, normalized_path, workspace_repository_delivery_target,
    workspace_repository_git_path,
};
use crate::{
    git,
    model::{SquashPreview, SquashRequest, SquashResponse},
};
use sha2::{Digest, Sha256};
use std::{
    io::Write,
    path::Path,
    process::{Command, Stdio},
};

fn blocked(message: impl Into<String>) -> AppError {
    AppError::api(StatusCode::CONFLICT, "SQUASH_BLOCKED", message)
}
fn denied(code: &'static str, message: impl Into<String>) -> AppError {
    AppError::api(StatusCode::CONFLICT, code, message)
}
fn output(path: &str, args: &[&str]) -> Result<String> {
    git::output(Path::new(path), args).map_err(AppError::BadRequest)
}
fn hash(value: &str) -> Result<()> {
    if !matches!(value.len(), 40 | 64) || !value.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(blocked(
            "Select full commit hashes from the current history",
        ));
    }
    Ok(())
}
fn clean(path: &str, expected: &str) -> Result<String> {
    hash(expected)?;
    let branch = output(path, &["symbolic-ref", "--quiet", "HEAD"])
        .map_err(|_| blocked("Squash requires a checked-out local branch"))?;
    if !branch.starts_with("refs/heads/") {
        return Err(blocked("Squash requires a local branch"));
    }
    if git_head(path)? != expected {
        return Err(denied(
            "SQUASH_STALE",
            "HEAD changed; refresh history and select again",
        ));
    }
    if !output(path, &["status", "--porcelain", "--untracked-files=all"])?.is_empty()
        || git_operation_in_progress(path)?
    {
        return Err(denied(
            "SQUASH_DIRTY",
            "Commit or discard all changes, including untracked files, and finish any Git operation first",
        ));
    }
    if output(path, &["rev-parse", "--is-shallow-repository"])? == "true"
        || !output(
            path,
            &["for-each-ref", "--format=%(refname)", "refs/replace"],
        )?
        .is_empty()
    {
        return Err(blocked(
            "Squash requires complete history without replacement objects",
        ));
    }
    Ok(branch)
}

pub(super) async fn workspace(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<SquashRequest>,
) -> Result<Json<SquashResponse>> {
    run(state, id, true, input).await
}
pub(super) async fn project(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<SquashRequest>,
) -> Result<Json<SquashResponse>> {
    run(state, id, false, input).await
}

async fn run(
    state: AppState,
    id: String,
    managed: bool,
    input: SquashRequest,
) -> Result<Json<SquashResponse>> {
    let repository_id = if managed {
        state
            .store
            .workspace_repository(&id)
            .await?
            .project_repository_id
    } else {
        id.clone()
    };
    let repository = state.store.repository_as_directory(&repository_id).await?;
    ensure_location_ready(&repository)?;
    let common = repository
        .git_common_dir
        .clone()
        .ok_or_else(|| blocked("Repository has no common directory"))?;
    blocking_git_operation_for(common, move || async move {
        // Resolve ownership again inside the same mutation lock as Finish.
        let mut location = if managed { Some(state.store.workspace_repository(&id).await?) } else { None };
        let mut path = if let Some(location) = &location { workspace_repository_git_path(location)?.to_owned() } else { repository.path.clone() };
        if location.is_none() {
            location = state.store.workspace_repositories_for_project_repository(&repository_id).await?
                .into_iter().find(|item| item.branch_ownership == "managed" && item.checkout_path.as_deref().is_some_and(|p| normalized_path(p) == normalized_path(&path)));
        }
        // Project Sessions have in-place records, not managed history ownership.
        if let Some(item) = &location {
            if state.store.workspace(&item.workspace_id).await?.kind == "base" {
                if item.access_mode != "read_write" {
                    return Err(denied("SQUASH_OWNERSHIP", "Repository is read-only"));
                }
                location = None;
            }
        }
        let mut boundary = None;
        let mut target = None;
        if let Some(location) = location {
            let workspace = state.store.workspace(&location.workspace_id).await?;
            if location.access_mode != "read_write" || workspace.status != "active"
                || !matches!(location.delivery_status.as_str(), "active" | "published")
                || state.store.finish_batch(&workspace.id).await?.is_some() {
                return Err(denied("SQUASH_OWNERSHIP", "Only an active writable Repository without a Finish operation can be squashed"));
            }
            if state.store.has_completed_integration(&location.id).await? {
                return Err(denied("SQUASH_DELIVERED", "This Repository has already been integrated; use the target Repository"));
            }
            for direction in ["integrate", "update"] {
                if let Some(operation) = state.store.latest_parent_operation(&location.id, direction).await? {
                    if matches!(operation.status.as_str(), "active" | "conflicted" | "resolving" | "recovery_required") {
                        return Err(denied("SQUASH_DELIVERED", "This Repository has an active operation or has already been delivered; use the target Repository"));
                    }
                }
            }
            path = workspace_repository_git_path(&location)?.to_owned();
            let branch = output(&path, &["branch", "--show-current"])?;
            if location.branch.as_deref() != Some(branch.as_str()) { return Err(blocked("Workspace branch changed")); }
            boundary = Some(location.start_commit.clone().ok_or_else(|| blocked("Workspace has no base commit"))?);
            let (target_path, target_branch) = workspace_repository_delivery_target(&state, &workspace, &location).await?;
            target = Some(output(&target_path, &["rev-parse", "--verify", &format!("refs/heads/{target_branch}")])?);
        }
        if state.store.active_parent_operation_for_target(&repository_id, &path).await?.is_some() {
            return Err(blocked("A parent operation owns this worktree"));
        }
        match input {
            SquashRequest::Preview { commits, expected_head } => {
                let plan = plan(&path, boundary.as_deref(), target.as_deref(), &commits, &expected_head)?;
                Ok(Json(SquashResponse { preview: Some(plan.preview), history: None, recovery_id: None }))
            }
            SquashRequest::Apply { commits, expected_head, message } => {
                let recovery_id = apply(&path, boundary.as_deref(), target.as_deref(), &commits, &expected_head, &message)?;
                Ok(Json(SquashResponse { preview: None, history: Some(git_history(&path)?), recovery_id: Some(recovery_id) }))
            }
            SquashRequest::Undo { recovery_id, expected_head } => {
                undo(&path, &recovery_id, &expected_head, target.as_deref())?;
                Ok(Json(SquashResponse { preview: None, history: Some(git_history(&path)?), recovery_id: None }))
            }
        }
    }).await
}

struct Plan {
    preview: SquashPreview,
    branch: String,
    parent: String,
    suffix: Vec<String>,
}
fn references(path: &str, oldest: &str, branch: &str) -> Result<Vec<String>> {
    let refs = output(
        path,
        &[
            "for-each-ref",
            &format!("--contains={oldest}"),
            "--format=%(refname)",
            "refs/heads",
            "refs/remotes",
            "refs/tags",
        ],
    )?;
    let mut shared = Vec::new();
    for reference in refs.lines() {
        if reference.starts_with("refs/remotes/") || reference.starts_with("refs/tags/") {
            return Err(denied(
                "SQUASH_PUBLISHED",
                format!(
                    "Rewritten history is referenced by {reference}; published or tagged commits cannot be squashed"
                ),
            ));
        }
        if reference != branch {
            shared.push(reference.trim_start_matches("refs/heads/").to_owned());
        }
    }
    Ok(shared)
}
fn plan(
    path: &str,
    boundary: Option<&str>,
    target: Option<&str>,
    commits: &[String],
    expected: &str,
) -> Result<Plan> {
    let branch = clean(path, expected)?;
    if commits.len() < 2 {
        return Err(denied(
            "SQUASH_COUNT",
            "Select at least two consecutive commits",
        ));
    }
    for commit in commits {
        hash(commit)?;
    }
    let oldest = &commits[0];
    let chain = output(path, &["rev-list", "--first-parent", "--reverse", expected])?;
    let chain: Vec<_> = chain.lines().collect();
    let start = chain
        .iter()
        .position(|c| *c == oldest)
        .ok_or_else(|| blocked("Selection is not on the current first-parent history"))?;
    // Preserve the root for project histories, or the fixed creation boundary for managed histories.
    let base = boundary.unwrap_or(chain[0]);
    let base_index = chain
        .iter()
        .position(|c| *c == base)
        .ok_or_else(|| blocked("Base is no longer on the current first-parent history"))?;
    if start <= base_index {
        return Err(denied(
            "SQUASH_BASE",
            "The base commit and earlier history cannot be rewritten",
        ));
    }
    let end = start + commits.len();
    if end > chain.len() || chain[start..end].iter().zip(commits).any(|(a, b)| *a != b) {
        return Err(denied(
            "SQUASH_RANGE",
            "Select a consecutive range in oldest-to-newest order",
        ));
    }
    let parent = chain[start - 1].to_owned();
    let merges = output(
        path,
        &[
            "rev-list",
            "--min-parents=2",
            &format!("{parent}..{expected}"),
        ],
    )?;
    if !merges.is_empty() {
        return Err(denied(
            "SQUASH_MERGE",
            "The selection or later history contains a merge commit",
        ));
    }
    if let Some(target) = target {
        if git_is_ancestor(path, oldest, target)? {
            return Err(denied(
                "SQUASH_TARGET",
                "Selected history is already integrated into the target; use the target Repository",
            ));
        }
    }
    let shared_branches = references(path, oldest, &branch)?;
    Ok(Plan {
        preview: SquashPreview {
            base: base.into(),
            branch: branch.trim_start_matches("refs/heads/").into(),
            selected_count: commits.len(),
            replayed_count: chain.len() - end,
            shared_branches,
        },
        branch,
        parent,
        suffix: chain[end..].iter().map(|s| (*s).into()).collect(),
    })
}

fn stdin_git(path: &str, args: &[&str], data: &str, env: &[(&str, &str)]) -> Result<String> {
    let mut child = Command::new("git")
        .current_dir(path)
        .args(args)
        .envs(env.iter().copied())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| blocked(e.to_string()))?;
    child
        .stdin
        .take()
        .unwrap()
        .write_all(data.as_bytes())
        .map_err(|e| blocked(e.to_string()))?;
    let output = child
        .wait_with_output()
        .map_err(|e| blocked(e.to_string()))?;
    if !output.status.success() {
        return Err(blocked(String::from_utf8_lossy(&output.stderr)));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().into())
}
fn tree(path: &str, commit: &str) -> Result<String> {
    output(path, &["rev-parse", &format!("{commit}^{{tree}}")])
}
fn recovery_prefix(branch: &str, id: &str) -> String {
    let branch = format!("{:x}", Sha256::digest(branch.as_bytes()));
    format!("refs/treefold/squash/{branch}/{id}")
}
fn apply(
    path: &str,
    boundary: Option<&str>,
    target: Option<&str>,
    commits: &[String],
    expected: &str,
    message: &str,
) -> Result<String> {
    if message.trim().is_empty() || message.contains('\0') {
        return Err(blocked("Enter a commit message"));
    }
    let prepared = plan(path, boundary, target, commits, expected)?;
    let selected_tree = tree(path, commits.last().unwrap())?;
    let mut head = stdin_git(
        path,
        &[
            "-c",
            "commit.gpgsign=false",
            "commit-tree",
            &selected_tree,
            "-p",
            &prepared.parent,
        ],
        message,
        &[],
    )?;
    for commit in &prepared.suffix {
        // Reparent exact snapshots. This preserves empty commits and every intermediate tree,
        // without cherry-pick conflicts or touching the user's index and working files.
        let commit_tree = tree(path, commit)?;
        let author = output(path, &["show", "-s", "--format=%an%x1f%ae%x1f%aI", commit])?;
        let fields: Vec<_> = author.split('\x1f').collect();
        if fields.len() != 3 {
            return Err(blocked("Could not read commit author"));
        }
        let raw = Command::new("git")
            .current_dir(path)
            .args(["cat-file", "commit", commit])
            .output()
            .map_err(|e| blocked(e.to_string()))?;
        if !raw.status.success() {
            return Err(blocked("Could not read original commit"));
        }
        let raw = String::from_utf8(raw.stdout)
            .map_err(|_| blocked("Squash requires UTF-8 commit messages"))?;
        let (_, body) = raw
            .split_once("\n\n")
            .ok_or_else(|| blocked("Invalid commit object"))?;
        head = stdin_git(
            path,
            &[
                "-c",
                "commit.gpgsign=false",
                "commit-tree",
                &commit_tree,
                "-p",
                &head,
            ],
            body,
            &[
                ("GIT_AUTHOR_NAME", fields[0]),
                ("GIT_AUTHOR_EMAIL", fields[1]),
                ("GIT_AUTHOR_DATE", fields[2]),
            ],
        )?;
    }
    if tree(path, &head)? != tree(path, expected)? {
        return Err(blocked("Squash did not preserve the final file tree"));
    }
    let rechecked = plan(path, boundary, target, commits, expected)?;
    if rechecked.branch != prepared.branch {
        return Err(blocked("Branch changed during squash"));
    }
    let id = new_id();
    let prefix = recovery_prefix(&prepared.branch, &id);
    stdin_git(
        path,
        &["update-ref", "--stdin"],
        &format!(
            "start\ncreate {prefix}/before {expected}\ncreate {prefix}/after {head}\nupdate {} {head} {expected}\nprepare\ncommit\n",
            prepared.branch
        ),
        &[],
    )?;
    Ok(id)
}
fn undo(path: &str, id: &str, expected: &str, target: Option<&str>) -> Result<()> {
    if id.len() != 32 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(blocked("Invalid recovery record"));
    }
    let branch = clean(path, expected)?;
    let prefix = recovery_prefix(&branch, id);
    let before = output(
        path,
        &["rev-parse", "--verify", &format!("{prefix}/before")],
    )?;
    let after = output(path, &["rev-parse", "--verify", &format!("{prefix}/after")])?;
    if expected != after || tree(path, &before)? != tree(path, &after)? {
        return Err(denied(
            "SQUASH_UNDO",
            "Undo is only available while HEAD still equals the squash result",
        ));
    }
    let base = output(path, &["merge-base", &before, &after])?;
    let rewritten = output(
        path,
        &["rev-list", "--reverse", &format!("{base}..{after}")],
    )?;
    let oldest = rewritten
        .lines()
        .next()
        .ok_or_else(|| blocked("Invalid recovery history"))?;
    references(path, oldest, &branch)?;
    if let Some(target) = target {
        if git_is_ancestor(path, oldest, target)? {
            return Err(blocked(
                "Squash result was delivered; Undo is no longer available",
            ));
        }
    }
    stdin_git(
        path,
        &["update-ref", "--stdin"],
        &format!(
            "start\nupdate {branch} {before} {after}\ndelete {prefix}/before {before}\ndelete {prefix}/after {after}\nprepare\ncommit\n"
        ),
        &[],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests;
