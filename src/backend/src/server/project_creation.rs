use std::{
    path::{Component, Path, PathBuf},
    process::Stdio,
    time::Duration,
};

use axum::{Json, extract::State, http::StatusCode};
use serde::{Deserialize, Serialize};

use super::{
    AppState,
    git_routes::blocking_git_operation,
    workspace::{self, CloneProjectRepository, CreateProject},
};
use crate::{
    error::{ApiJson, AppError, Result},
    model::Project,
};

#[derive(Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(super) enum ProjectSource {
    GitUrl { url: String },
    Empty { parent_path: String },
}

#[derive(Deserialize)]
pub(super) struct CreateProjectRequest {
    #[serde(flatten)]
    project: CreateProject,
    source: Option<ProjectSource>,
}

#[derive(Deserialize)]
pub(super) struct ValidateProjectSource {
    name: String,
    source: ProjectSource,
}

#[derive(Serialize)]
pub(super) struct ValidatedProjectSource {
    path: Option<String>,
}

fn invalid(code: &'static str, message: &str) -> AppError {
    AppError::api(StatusCode::BAD_REQUEST, code, message)
}

fn validate_name(name: &str) -> Result<&str> {
    let name = name.trim();
    if name.is_empty() {
        return Err(invalid("PROJECT_NAME_REQUIRED", "Project name is required"));
    }
    Ok(name)
}

fn validate_url(url: &str) -> Result<&str> {
    let url = url.trim();
    let scheme_url = ["https://", "http://", "ssh://", "git://", "file://"]
        .iter()
        .any(|prefix| {
            url.strip_prefix(prefix)
                .is_some_and(|rest| !rest.is_empty())
        });
    let scp_url = url.split_once(':').is_some_and(|(host, path)| {
        !host.is_empty() && !host.contains('/') && !path.is_empty() && !path.starts_with(':')
    });
    if url.starts_with('-')
        || url.chars().any(char::is_whitespace)
        || !(scheme_url || scp_url && !url.contains("://"))
    {
        return Err(invalid(
            "INVALID_GIT_URL",
            "Enter a Git URL using HTTPS, SSH, or Git transport",
        ));
    }
    Ok(url)
}

fn empty_destination(parent_path: &str, name: &str) -> Result<PathBuf> {
    let name = validate_name(name)?;
    let mut components = Path::new(name).components();
    if !matches!(components.next(), Some(Component::Normal(_)))
        || components.next().is_some()
        || name.contains(['/', '\\'])
        || name.chars().any(char::is_control)
    {
        return Err(invalid(
            "INVALID_PROJECT_FOLDER_NAME",
            "Use a folder name without path separators",
        ));
    }
    let parent = Path::new(parent_path.trim());
    if !parent.is_absolute() {
        return Err(invalid(
            "INVALID_PROJECT_PARENT",
            "Choose an existing absolute parent directory",
        ));
    }
    let parent = parent
        .canonicalize()
        .map_err(|_| invalid("INVALID_PROJECT_PARENT", "Parent directory does not exist"))?;
    if !parent.is_dir() {
        return Err(invalid(
            "INVALID_PROJECT_PARENT",
            "Parent path must be a directory",
        ));
    }
    let parent_cstr = std::ffi::CString::new(parent.as_os_str().as_encoded_bytes())
        .map_err(|_| invalid("INVALID_PROJECT_PARENT", "Invalid parent directory"))?;
    // SAFETY: parent_cstr is a valid NUL-terminated path for the duration of access().
    if unsafe { libc::access(parent_cstr.as_ptr(), libc::W_OK | libc::X_OK) } != 0 {
        return Err(invalid(
            "PROJECT_PARENT_NOT_WRITABLE",
            "Cannot create a folder in this parent directory",
        ));
    }
    let target = parent.join(name);
    match target.symlink_metadata() {
        Ok(_) => {
            return Err(invalid(
                "PROJECT_DESTINATION_EXISTS",
                "A file or directory already exists at this location",
            ));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => {
            return Err(invalid(
                "INVALID_PROJECT_PARENT",
                "Cannot access the parent directory",
            ));
        }
    }
    Ok(target)
}

pub(super) async fn validate_source(
    ApiJson(input): ApiJson<ValidateProjectSource>,
) -> Result<Json<ValidatedProjectSource>> {
    validate_name(&input.name)?;
    let path = match input.source {
        ProjectSource::GitUrl { url } => {
            let url = validate_url(&url)?;
            let output = tokio::time::timeout(
                Duration::from_secs(30),
                tokio::process::Command::new("git")
                    .args(["ls-remote", "--symref", "--", url, "HEAD"])
                    .env("GIT_TERMINAL_PROMPT", "0")
                    .stdin(Stdio::null())
                    .kill_on_drop(true)
                    .output(),
            )
            .await
            .map_err(|_| {
                invalid(
                    "GIT_REMOTE_TIMEOUT",
                    "Repository check timed out. Check the URL and your Git authentication",
                )
            })?
            .map_err(|error| AppError::BadRequest(format!("check repository: {error}")))?;
            if !output.status.success() {
                return Err(invalid(
                    "GIT_REMOTE_UNAVAILABLE",
                    "Cannot access the repository. Check the URL and your Git authentication",
                ));
            }
            None
        }
        ProjectSource::Empty { parent_path } => Some(
            empty_destination(&parent_path, &input.name)?
                .to_string_lossy()
                .into_owned(),
        ),
    };
    Ok(Json(ValidatedProjectSource { path }))
}

pub(super) async fn create_project(
    State(state): State<AppState>,
    ApiJson(input): ApiJson<CreateProjectRequest>,
) -> Result<(StatusCode, Json<Project>)> {
    // Keep the local import contract intact. All filesystem work runs off the async executor.
    blocking_git_operation(move || create_project_impl(state, input)).await
}

async fn create_project_impl(
    state: AppState,
    mut input: CreateProjectRequest,
) -> Result<(StatusCode, Json<Project>)> {
    let Some(source) = input.source else {
        return workspace::create_project(State(state), ApiJson(input.project)).await;
    };
    validate_name(input.project.name.as_deref().unwrap_or(""))?;
    if input.project.path.is_some()
        || input.project.locations.is_some()
        || input.project.open_path.is_some()
    {
        return Err(invalid(
            "CONFLICTING_PROJECT_SOURCE",
            "Choose one Project source",
        ));
    }
    match source {
        ProjectSource::GitUrl { url } => {
            let url = validate_url(&url)?.to_owned();
            let project = workspace::create_project_impl(state.clone(), input.project).await?;
            let result = async {
                let (_, Json(directory)) = workspace::clone_project_repository_impl(
                    state.clone(),
                    project.id.clone(),
                    CloneProjectRepository {
                        url,
                        name: None,
                        preferred_remote_name: None,
                        setup_command: None,
                    },
                )
                .await?;
                state
                    .store
                    .set_project_open_path(&project.id, &directory.path)
                    .await
            }
            .await;
            if let Err(error) = result {
                // The Project and its managed source belong exclusively to this creation attempt.
                state.store.delete_project(&project.id).await?;
                let managed = state
                    .settings
                    .treefold_home()
                    .join("git/s")
                    .join(&project.id);
                if managed.exists() {
                    let _ = std::fs::remove_dir_all(managed);
                }
                return Err(error);
            }
            Ok((
                StatusCode::CREATED,
                Json(state.store.project(&project.id).await?),
            ))
        }
        ProjectSource::Empty { parent_path } => {
            let target =
                empty_destination(&parent_path, input.project.name.as_deref().unwrap_or(""))?;
            // create_dir also protects against a destination appearing after validation.
            std::fs::create_dir(&target).map_err(|error| {
                AppError::BadRequest(format!("create Project directory: {error}"))
            })?;
            if let Err(error) = crate::git::output(&target, &["init"]) {
                let _ = std::fs::remove_dir_all(target.join(".git"));
                let _ = std::fs::remove_dir(&target);
                return Err(AppError::BadRequest(format!(
                    "initialize repository: {error}"
                )));
            }
            input.project.path = Some(target.to_string_lossy().into_owned());
            let result = workspace::create_project_impl(state, input.project).await;
            if result.is_err() {
                let _ = std::fs::remove_dir_all(target.join(".git"));
                let _ = std::fs::remove_dir(&target);
            }
            result.map(|project| (StatusCode::CREATED, Json(project)))
        }
    }
}

#[cfg(test)]
mod tests;
