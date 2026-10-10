use std::path::Path;

use axum::{Json, extract::State};
use serde::{Deserialize, Serialize};

use super::{AppState, workspace::inspect_project_path_value};
use crate::{
    error::{ApiJson, AppError, Result},
    store::Store,
};

#[derive(Deserialize)]
pub(super) struct OpenProjectPath {
    path: String,
}

#[derive(Serialize)]
pub(super) struct ResolvedProjectPath {
    path: String,
    project_id: Option<String>,
}

pub(super) async fn resolve(
    State(state): State<AppState>,
    ApiJson(input): ApiJson<OpenProjectPath>,
) -> Result<Json<ResolvedProjectPath>> {
    Ok(Json(resolve_path(&state.store, &input.path).await?))
}

async fn resolve_path(store: &Store, value: &str) -> Result<ResolvedProjectPath> {
    let path = Path::new(value);
    if !path.is_absolute() || !path.is_dir() {
        return Err(AppError::BadRequest(
            "Choose an existing absolute directory".into(),
        ));
    }
    let path = path
        .canonicalize()
        .map_err(|error| AppError::BadRequest(error.to_string()))?;
    let mut best: Option<(usize, bool, String)> = None;
    let projects = store.projects().await?;
    // Explicit import roots take precedence over inferred directory membership.
    let mut entry_match = None;
    for project in &projects {
        if project
            .open_path
            .as_deref()
            .and_then(|value| Path::new(value).canonicalize().ok())
            .as_ref()
            == Some(&path)
            && entry_match
                .as_ref()
                .is_none_or(|(_, active)| project.status == "active" && !active)
        {
            entry_match = Some((project.id.clone(), project.status == "active"));
        }
    }
    if let Some((id, _)) = entry_match {
        return Ok(ResolvedProjectPath {
            path: path.to_string_lossy().into_owned(),
            project_id: Some(id),
        });
    }
    let mut project_locations = Vec::new();
    for project in projects {
        let mut locations = store
            .directories(&project.id)
            .await?
            .into_iter()
            .map(|d| d.path)
            .collect::<Vec<_>>();
        // Keep Project locations separate: a container should not be identified
        // by a collection of temporary Workspace checkouts.
        project_locations.push((
            project.id.clone(),
            project.status == "active",
            locations
                .iter()
                .filter_map(|location| Path::new(location).canonicalize().ok())
                .collect::<std::collections::HashSet<_>>(),
        ));
        for workspace in store.workspaces(&project.id).await? {
            locations.extend(
                store
                    .workspace_directories(&workspace.id)
                    .await?
                    .into_iter()
                    .map(|d| d.path),
            );
        }
        for location in locations {
            let Ok(location) = Path::new(&location).canonicalize() else {
                continue;
            };
            // Component-aware containment avoids matching /repo-other to /repo.
            if path.starts_with(&location) {
                let score = (location.components().count(), project.status == "active");
                if best
                    .as_ref()
                    .is_none_or(|(depth, active, _)| score > (*depth, *active))
                {
                    best = Some((score.0, score.1, project.id.clone()));
                }
            }
        }
    }
    if best.is_none() {
        // Local import records selected candidates, not their container. Reuse
        // its discovery rules, including directory symlinks, to recognize a
        // previously imported multi-repository parent without another write.
        let inspection = inspect_project_path_value(&path.to_string_lossy())?;
        if inspection
            .candidates
            .iter()
            .any(|candidate| candidate.is_git)
        {
            for (id, active, locations) in project_locations {
                if inspection
                    .candidates
                    .iter()
                    .all(|candidate| locations.contains(Path::new(&candidate.path)))
                    && best
                        .as_ref()
                        .is_none_or(|(_, current_active, _)| active && !current_active)
                {
                    best = Some((0, active, id));
                }
            }
        }
    }
    Ok(ResolvedProjectPath {
        path: path.to_string_lossy().into_owned(),
        project_id: best.map(|(_, _, id)| id),
    })
}

#[cfg(test)]
mod tests;
