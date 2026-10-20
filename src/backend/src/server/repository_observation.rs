//! Live repository observations, kept separate from persistence records and API DTOs.
use super::{
    git_routes::{command_output, git_remote_names, repository_identity_matches},
    now,
};
use crate::{
    error::{AppError, Result},
    model::ProjectRepository,
};
use std::path::Path;

pub(super) struct ObservedGit {
    pub root: String,
    pub common_dir: String,
    pub remote: Option<String>,
    pub url: Option<String>,
}
pub(super) struct Observation {
    pub status: &'static str,
    pub checked_at: String,
    pub not_git: bool,
    pub git: Option<ObservedGit>,
}

pub(super) fn observe(
    path: &str,
    known_git: bool,
    expected_url: Option<&str>,
    preferred_remote: Option<&str>,
) -> Result<Observation> {
    let mut result = Observation {
        status: "ready",
        checked_at: now(),
        not_git: false,
        git: None,
    };
    let source_path = path;
    let path = Path::new(path);
    if !path.exists() {
        result.status = "missing";
        return Ok(result);
    }
    if !path.is_dir() {
        result.status = "broken";
        return Ok(result);
    }
    if command_output(path, "git", &["rev-parse", "--is-inside-work-tree"]).is_err() {
        result.status = if known_git { "broken" } else { "not_git" };
        result.not_git = true;
        return Ok(result);
    }
    let common_dir = command_output(
        path,
        "git",
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )
    .map_err(AppError::BadRequest)?;
    let root = command_output(path, "git", &["rev-parse", "--show-toplevel"])
        .map_err(AppError::BadRequest)?;
    let remotes = git_remote_names(source_path)?;
    let remote = preferred_remote
        .filter(|name| remotes.iter().any(|remote| remote == name))
        .map(str::to_owned)
        .or_else(|| {
            remotes
                .iter()
                .find(|name| name.as_str() == "origin")
                .cloned()
        })
        .or_else(|| remotes.first().cloned());
    let url = remote
        .as_ref()
        .and_then(|name| command_output(path, "git", &["remote", "get-url", name]).ok());
    if let (Some(expected), Some(observed)) = (expected_url, url.as_deref()) {
        if !repository_identity_matches(path, expected, observed) {
            result.status = "mismatch";
            return Ok(result);
        }
    }
    result.git = Some(ObservedGit {
        root,
        common_dir,
        remote,
        url,
    });
    Ok(result)
}

/// Refresh runtime fields without changing the configured source path.
pub(super) fn refresh(repository: &mut ProjectRepository) -> Result<Option<String>> {
    let observation = observe(
        &repository.source_root,
        true,
        repository.repository_url.as_deref(),
        repository.preferred_remote_name.as_deref(),
    )?;
    repository.git_status = observation.status.into();
    repository.last_checked_at = Some(observation.checked_at);
    if let Some(git) = observation.git {
        repository.git_common_dir = git.common_dir;
        repository.preferred_remote_name = git.remote;
        repository.repository_url = git.url.or_else(|| repository.repository_url.clone());
        Ok(Some(git.root))
    } else {
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repository(root: &Path) -> ProjectRepository {
        command_output(root, "git", &["init", "--initial-branch=main"]).unwrap();
        ProjectRepository {
            id: "repository".into(),
            project_id: "project".into(),
            name: "source".into(),
            source_root: root.to_string_lossy().into_owned(),
            git_common_dir: root.join(".git").to_string_lossy().into_owned(),
            source_ownership: "external".into(),
            repository_url: None,
            preferred_remote_name: None,
            setup_command: String::new(),
            setup_workdir: ".".into(),
            git_status: "ready".into(),
            last_checked_at: None,
            created_at: now(),
            updated_at: now(),
        }
    }

    #[test]
    fn unavailable_repository_retains_identity_and_recovers_when_path_returns() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("source");
        std::fs::create_dir(&root).unwrap();
        let mut saved = repository(&root);
        saved.repository_url = Some("https://example.invalid/original.git".into());
        saved.preferred_remote_name = Some("upstream".into());
        let common = saved.git_common_dir.clone();
        let moved = temp.path().join("moved");
        std::fs::rename(&root, &moved).unwrap();
        assert!(refresh(&mut saved).unwrap().is_none());
        assert_eq!(saved.git_status, "missing");
        assert_eq!(saved.git_common_dir, common);
        assert_eq!(saved.preferred_remote_name.as_deref(), Some("upstream"));
        assert_eq!(
            saved.repository_url.as_deref(),
            Some("https://example.invalid/original.git")
        );
        assert!(saved.last_checked_at.is_some());
        std::fs::rename(&moved, &root).unwrap();
        assert!(refresh(&mut saved).unwrap().is_some());
        assert_eq!(saved.git_status, "ready");
        // A repository without remotes must not erase its saved identity.
        assert_eq!(
            saved.repository_url.as_deref(),
            Some("https://example.invalid/original.git")
        );
    }

    #[test]
    fn different_remote_is_rejected_without_replacing_saved_identity() {
        let temp = tempfile::tempdir().unwrap();
        let mut saved = repository(temp.path());
        saved.repository_url = Some("https://example.invalid/original.git".into());
        command_output(
            temp.path(),
            "git",
            &[
                "remote",
                "add",
                "origin",
                "https://example.invalid/other.git",
            ],
        )
        .unwrap();
        assert!(refresh(&mut saved).unwrap().is_none());
        assert_eq!(saved.git_status, "mismatch");
        assert_eq!(
            saved.repository_url.as_deref(),
            Some("https://example.invalid/original.git")
        );
        assert_eq!(saved.preferred_remote_name, None);
    }

    #[test]
    fn ordinary_directory_and_broken_repository_remain_distinct() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().to_str().unwrap();
        assert_eq!(observe(path, false, None, None).unwrap().status, "not_git");
        assert_eq!(observe(path, true, None, None).unwrap().status, "broken");
    }
}
