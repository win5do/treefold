//! Squash integration uses the durable parent-operation journal, not ancestry
//! of the source commits, to recognize a completed delivery after a restart.
use super::{
    AppError, AppState, ParentOperation, ParentOperationUpdate, Result, command_output, git_head,
    git_is_ancestor, has_unmerged_paths,
};
use std::path::Path;

pub(super) fn validate_message(message: &str) -> Result<()> {
    if message.trim().is_empty()
        || message.contains('\0')
        || message
            .lines()
            .any(|line| line.trim_start().starts_with("Treefold-Squash:"))
    {
        return Err(AppError::api(
            super::StatusCode::BAD_REQUEST,
            "SQUASH_MESSAGE_INVALID",
            "Enter a non-empty commit message without a Treefold-Squash marker",
        ));
    }
    Ok(())
}

fn message(operation: &ParentOperation) -> String {
    let title = operation
        .commit_message
        .clone()
        .unwrap_or_else(|| format!("Squash {}", operation.source_branch));
    format!("{}\n\nTreefold-Squash: {}", title.trim(), operation.id)
}

pub(super) fn continue_command(operation: &ParentOperation) -> String {
    format!(
        "git commit --allow-empty -m '{}'",
        message(operation).replace('\'', "'\"'\"'")
    )
}

pub(super) fn execute(operation: &ParentOperation) -> std::result::Result<String, String> {
    let path = Path::new(&operation.target_path);
    if git_is_ancestor(
        &operation.target_path,
        &operation.source_head,
        &operation.before_head,
    )
    .map_err(|e| e.to_string())?
    {
        return Ok(String::new());
    }
    command_output(
        path,
        "git",
        &["merge", "--squash", "--no-commit", &operation.source_head],
    )?;
    command_output(
        path,
        "git",
        &["commit", "--allow-empty", "-m", &message(operation)],
    )
}

pub(super) async fn reconcile(
    state: &AppState,
    operation: &ParentOperation,
) -> Result<ParentOperation> {
    let path = Path::new(&operation.target_path);
    let head = git_head(&operation.target_path)?;
    let branch =
        command_output(path, "git", &["branch", "--show-current"]).map_err(AppError::BadRequest)?;
    let dirty = !command_output(
        path,
        "git",
        &["status", "--porcelain", "--untracked-files=all"],
    )
    .map_err(AppError::BadRequest)?
    .is_empty();
    let parents = command_output(path, "git", &["show", "-s", "--format=%P", &head])
        .map_err(AppError::BadRequest)?;
    let body = command_output(path, "git", &["show", "-s", "--format=%B", &head])
        .map_err(AppError::BadRequest)?;
    let marker = format!("Treefold-Squash: {}", operation.id);
    let completed = branch == operation.target_branch
        && !dirty
        && ((parents == operation.before_head && body.lines().any(|line| line == marker))
            || (head == operation.before_head
                && git_is_ancestor(&operation.target_path, &operation.source_head, &head)?));
    let (status, error) = if completed {
        ("completed", "")
    } else if branch != operation.target_branch || head != operation.before_head {
        (
            "recovery_required",
            "Squash target moved without the expected single-parent delivery commit",
        )
    } else if has_unmerged_paths(&operation.target_path)? {
        (
            "conflicted",
            "Resolve and stage conflicts, then commit with the Treefold squash marker",
        )
    } else if dirty {
        (
            if operation.status == "resolving" {
                "resolving"
            } else {
                "conflicted"
            },
            "Squash changes are awaiting a commit; complete or abort this operation",
        )
    } else {
        (
            "recovery_required",
            "Squash was interrupted or its changes were discarded; abort before retrying",
        )
    };
    state
        .store
        .update_parent_operation(ParentOperationUpdate {
            id: &operation.id,
            status,
            phase: status,
            result_head: if completed { Some(&head) } else { None },
            error,
            terminal: completed,
        })
        .await?;
    if completed {
        super::parent_operation::release_parent_operation_recovery(state, operation).await?;
    }
    state.store.parent_operation(&operation.id).await
}
