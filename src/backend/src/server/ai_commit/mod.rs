//! HTTP boundary for one-shot AI Commit jobs. Saved commands are selected once
//! per request. Testing takes the unsaved command and a synthetic diff. Both use
//! an isolated temporary cwd: repository context is supplied explicitly on stdin.
mod context;
#[cfg(test)]
mod tests;

use crate::{
    ai_commit::Job,
    error::{ApiJson, AppError, Result},
    model::ai_commit::{
        GenerationRequest as Request, GenerationSource as Source, TestGenerationRequest,
    },
    server::AppState,
};
use axum::{
    Json,
    extract::{Path, State},
};
use serde::Serialize;

pub(super) async fn generate(
    State(state): State<AppState>,
    ApiJson(input): ApiJson<Request>,
) -> Result<Json<Job>> {
    let command = state.settings.load()?.ai_commit.command;
    if command.trim().is_empty() {
        return Err(AppError::BadRequest(
            "Configure an AI Commit command first".into(),
        ));
    }
    let worker = state.clone();
    let job = state.ai_commit.start(async move {
        let context = context::prepare(&worker, &input).await?;
        let cwd = tempfile::tempdir()?;
        let message = crate::ai_commit::run(&command, &context.prompt, cwd.path()).await?;
        context.verify().await?;
        Ok(message)
    })?;
    Ok(Json(job))
}
pub(super) async fn test(
    State(state): State<AppState>,
    ApiJson(input): ApiJson<TestGenerationRequest>,
) -> Result<Json<Job>> {
    let job = state.ai_commit.start(async move {
        let cwd = tempfile::tempdir()?;
        crate::ai_commit::run(&input.command, &context::test_prompt(), cwd.path()).await
    })?;
    Ok(Json(job))
}
pub(super) async fn get(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Job>> {
    state.ai_commit.get(&id).map(Json).ok_or(AppError::NotFound)
}
pub(super) async fn cancel(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Job>> {
    state
        .ai_commit
        .cancel(&id)
        .map(Json)
        .ok_or(AppError::NotFound)
}

#[derive(Serialize)]
pub(super) struct Preset {
    kind: String,
    command: String,
}

pub(super) async fn presets(State(state): State<AppState>) -> Result<Json<Vec<Preset>>> {
    let settings = state.settings.load()?;
    let mut presets = Vec::new();
    for kind in &settings.agents.order {
        let config = settings
            .agents
            .get(kind)
            .ok_or_else(|| AppError::BadRequest("Unknown Agent".into()))?;
        let (executable, _) = crate::agents::parse_command(kind, &config.command)?;
        // The preset reuses the executable location, not interactive Session
        // arguments such as resume, workspace permissions or integration hooks.
        let executable = shell_words::quote(&executable);
        let args = match kind.as_str() {
            "codex" => {
                "exec --ephemeral --skip-git-repo-check --sandbox read-only -c model_reasoning_effort=low -"
            }
            "claude_code" => {
                "-p --output-format text --no-session-persistence --tools '' --effort low"
            }
            "opencode" => "run --format json",
            "pi" => {
                "--print --no-session --no-tools --no-extensions --no-skills --no-context-files --thinking low"
            }
            _ => continue,
        };
        presets.push(Preset {
            kind: kind.clone(),
            command: format!("{executable} {args}"),
        });
    }
    Ok(Json(presets))
}
