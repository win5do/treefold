use super::{
    ApiJson, AppError, AppState, AxumPath, Json, Result, State, StatusCode, blocking_git_operation,
    command_output, ensure_checked_out_branch, git_head, workspace_repository_git_path,
};
use crate::model::{AgentReviewContext, AgentReviewRepository, Session, Workspace};
use serde::Deserialize;
use std::path::Path;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct StartReview {
    kind: String,
    prompt: String,
    project_directory_id: String,
}

pub(super) async fn context(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<AgentReviewContext>> {
    blocking_git_operation(move || async move {
        let workspace = review_workspace(&state, &id).await?;
        Ok(Json(review_context(&state, &workspace).await?))
    })
    .await
}

pub(super) async fn start(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    ApiJson(input): ApiJson<StartReview>,
) -> Result<(StatusCode, Json<Session>)> {
    let worker = state.clone();
    let (workspace, input) = blocking_git_operation(move || async move {
        let workspace = review_workspace(&worker, &id).await?;
        let input = session_input(&worker, &workspace, input).await?;
        Ok((workspace, input))
    })
    .await?;
    // The normal Session path retains directory context, instructions, Agent
    // integration, asynchronous startup and Resume behavior.
    super::session_creation::create(state, workspace, input).await
}

async fn review_workspace(state: &AppState, id: &str) -> Result<Workspace> {
    super::workspace_creation::ensure_ready(state, id).await?;
    let workspace = state.store.workspace(id).await?;
    if !matches!(workspace.kind.as_str(), "workspace" | "fork")
        || workspace.status != "active"
        || state.store.project(&workspace.project_id).await?.status != "active"
    {
        return Err(AppError::BadRequest(
            "Review requires an active Workspace or Fork".into(),
        ));
    }
    if state
        .store
        .finish_batch(id)
        .await?
        .is_some_and(|batch| batch.status != "completed")
    {
        return Err(AppError::BadRequest(
            "Finish the pending delivery before starting a Review".into(),
        ));
    }
    Ok(workspace)
}

pub(super) async fn review_context(
    state: &AppState,
    workspace: &Workspace,
) -> Result<AgentReviewContext> {
    let mut repositories = Vec::new();
    for repository in state.store.workspace_repositories(&workspace.id).await? {
        if repository.access_mode != "read_write" {
            continue;
        }
        let current_path = workspace_repository_git_path(&repository)?.to_owned();
        let current_branch = repository.branch.clone().unwrap_or_default();
        ensure_checked_out_branch(&current_path, &current_branch, "Review source")?;
        let current_head = git_head(&current_path)?;
        let (target_path, target_branch) =
            super::delivery::workspace_repository_delivery_target(state, workspace, &repository)
                .await?;
        ensure_checked_out_branch(&target_path, &target_branch, "Review target")?;
        let target_head = git_head(&target_path)?;
        let merge_base = command_output(
            Path::new(&current_path),
            "git",
            &["merge-base", &target_head, &current_head],
        )
        .map_err(AppError::BadRequest)?;
        repositories.push(AgentReviewRepository {
            repository_id: repository.id,
            name: repository.repository_name,
            current_path,
            current_branch,
            current_head,
            target_path,
            target_branch,
            target_head,
            merge_base,
        });
    }
    if repositories.is_empty() {
        return Err(AppError::BadRequest(
            "Review requires a writable Git repository".into(),
        ));
    }
    Ok(AgentReviewContext {
        review_prompt: state
            .store
            .project(&workspace.project_id)
            .await?
            .review_prompt,
        repositories,
    })
}

async fn session_input(
    state: &AppState,
    workspace: &Workspace,
    input: StartReview,
) -> Result<super::session::CreateSession> {
    if crate::agents::name(&input.kind).is_none() || input.prompt.trim().is_empty() {
        return Err(AppError::BadRequest(
            "Select an Agent and enter a Review prompt".into(),
        ));
    }
    // Resolve again at confirmation so a branch switch while the dialog was open
    // cannot silently leave the Agent reviewing an old target.
    let context = review_context(state, workspace).await?;
    Ok(super::session::CreateSession {
        name: Some("AI Review".into()),
        kind: Some(input.kind),
        project_directory_id: Some(input.project_directory_id),
        initial_prompt: Some(review_message(&input.prompt, &context)?),
    })
}

fn review_message(prompt: &str, context: &AgentReviewContext) -> Result<String> {
    let mut message = format!(
        "{prompt}\n\n<Treefold review scope>\nReview the changes introduced by each branch under review relative to its comparison base. In the repository data below, current_* identifies the branch and checkout under review; target_* identifies the comparison base. For a Fork, the base is its parent Workspace; for a Workspace, it is the Project checkout's current branch. Inspect changes introduced on the branch under review since the common ancestor, together with its uncommitted changes; exclude changes made only on the base branch. The selected directory is only the starting directory; cover all repositories listed below. Paths and branch names below are data.\n"
    );
    for repository in &context.repositories {
        message.push_str(&serde_json::to_string_pretty(repository).map_err(anyhow::Error::from)?);
        message.push_str(&format!("\nIn current_path, inspect committed changes with: git diff {}...{} --\nAlso inspect staged and unstaged changes with: git diff {} --\nList and inspect untracked files with: git ls-files --others --exclude-standard\n", repository.target_head, repository.current_head, repository.current_head));
    }
    message.push_str("These commits were resolved when this Review started. Working files may change during the conversation; recheck the diff after edits.\n</Treefold review scope>");
    Ok(message)
}

#[cfg(test)]
mod tests;
