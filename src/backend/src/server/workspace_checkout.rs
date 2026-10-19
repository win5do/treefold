//! Resolve explicit per-Repository creation choices before persisting a Workspace.
use std::{collections::HashMap, path::Path};

use serde::{Deserialize, Serialize};

use super::git_routes::{command_output, git_remote_names, git_worktrees};
use crate::{
    error::{AppError, Result},
    model::Directory,
};

#[derive(Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(super) enum BranchRef {
    Local { branch: String },
    Remote { remote: String, branch: String },
}

#[derive(Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub(super) enum Checkout {
    New {
        branch: String,
        base: BranchRef,
    },
    Existing {
        source: BranchRef,
        local_branch: Option<String>,
    },
}

#[derive(Clone, Deserialize, Serialize)]
pub(super) struct Upstream {
    pub(super) remote: String,
    pub(super) branch: String,
}

#[derive(Deserialize)]
pub(super) struct RepositoryCheckout {
    pub(super) repository_id: String,
    pub(super) checkout: Checkout,
    pub(super) upstream: Option<Upstream>,
}

pub(super) struct ResolvedCheckout {
    pub(super) branch: String,
    pub(super) base_branch: String,
    pub(super) commit: String,
    pub(super) reuse_branch: bool,
    pub(super) upstream: Option<Upstream>,
}

fn valid_branch(path: &str, branch: &str) -> Result<()> {
    if branch.is_empty() || branch.starts_with('-') || branch == "HEAD" {
        return Err(AppError::BadRequest("invalid branch name".into()));
    }
    command_output(
        Path::new(path),
        "git",
        &["check-ref-format", &format!("refs/heads/{branch}")],
    )
    .map(|_| ())
    .map_err(|_| AppError::BadRequest(format!("invalid branch name '{branch}'")))
}

fn resolve(location: &Directory, input: &RepositoryCheckout) -> Result<ResolvedCheckout> {
    let path = &location.path;
    let remotes = git_remote_names(path)?;
    let (branch, source, reuse_branch) = match &input.checkout {
        Checkout::New { branch, base } => (branch.clone(), base, false),
        Checkout::Existing {
            source,
            local_branch,
        } => match source {
            BranchRef::Local { branch } => {
                if local_branch.as_ref().is_some_and(|name| name != branch) {
                    return Err(AppError::BadRequest(
                        "an existing local branch cannot be renamed during checkout".into(),
                    ));
                }
                (branch.clone(), source, true)
            }
            BranchRef::Remote { branch, .. } => (
                local_branch.clone().unwrap_or_else(|| branch.clone()),
                source,
                false,
            ),
        },
    };
    valid_branch(path, &branch)?;
    let (reference, base_branch) = match source {
        BranchRef::Local { branch } => {
            valid_branch(path, branch)?;
            (format!("refs/heads/{branch}"), branch.clone())
        }
        BranchRef::Remote { remote, branch } => {
            if !remotes.contains(remote) {
                return Err(AppError::BadRequest(format!(
                    "remote '{remote}' was not found"
                )));
            }
            valid_branch(path, branch)?;
            (
                format!("refs/remotes/{remote}/{branch}"),
                format!("{remote}/{branch}"),
            )
        }
    };
    let commit = command_output(
        Path::new(path),
        "git",
        &["rev-parse", "--verify", &format!("{reference}^{{commit}}")],
    )
    .map_err(|_| AppError::BadRequest(format!("branch '{base_branch}' was not found")))?;
    if reuse_branch {
        if let Some(worktree) = git_worktrees(path)?
            .iter()
            .find(|worktree| worktree.branch == branch)
        {
            return Err(AppError::BadRequest(format!(
                "branch '{branch}' is already checked out at {}",
                worktree.path
            )));
        }
    } else if command_output(
        Path::new(path),
        "git",
        &["show-ref", "--verify", &format!("refs/heads/{branch}")],
    )
    .is_ok()
    {
        return Err(AppError::BadRequest(format!(
            "local branch '{branch}' already exists; choose an existing branch or another name"
        )));
    }
    if let Some(upstream) = &input.upstream {
        if !remotes.contains(&upstream.remote) {
            return Err(AppError::BadRequest(format!(
                "remote '{}' was not found",
                upstream.remote
            )));
        }
        valid_branch(path, &upstream.branch)?;
    }
    Ok(ResolvedCheckout {
        branch,
        base_branch,
        commit,
        reuse_branch,
        upstream: input.upstream.clone(),
    })
}

pub(super) fn resolve_repositories(
    locations: &[Directory],
    inputs: &[RepositoryCheckout],
) -> Result<HashMap<String, ResolvedCheckout>> {
    if inputs.len() != locations.len() {
        return Err(AppError::BadRequest(
            "provide a checkout choice for every Repository".into(),
        ));
    }
    let mut resolved = HashMap::new();
    for input in inputs {
        let location = locations
            .iter()
            .find(|location| location.id == input.repository_id)
            .ok_or_else(|| {
                AppError::BadRequest("Repository does not belong to this Project".into())
            })?;
        if resolved.contains_key(&input.repository_id) {
            return Err(AppError::BadRequest(
                "duplicate Repository checkout choice".into(),
            ));
        }
        let checkout = resolve(location, input).map_err(|error| {
            AppError::BadRequest(format!("Repository '{}': {error}", location.name))
        })?;
        resolved.insert(input.repository_id.clone(), checkout);
    }
    Ok(resolved)
}
