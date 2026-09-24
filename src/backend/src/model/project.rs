use serde::{Deserialize, Serialize};

use super::{GitWorktree, Session, Workspace};
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub description: String,
    pub status: String,
    #[serde(
        rename = "default_directory_id",
        skip_serializing_if = "Option::is_none"
    )]
    pub default_location_id: Option<String>,
    #[serde(skip)]
    pub default_delivery_mode: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip)]
    pub primary_directory_id: String,
    #[serde(skip)]
    pub git_common_dir: String,
    #[serde(skip)]
    pub preferred_remote: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Directory {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub description: String,
    pub worktree_setup_command: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repository_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preferred_remote_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delivery_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_common_dir: Option<String>,
    pub git_status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_checked_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip)]
    pub checkout_path: Option<String>,
    #[serde(skip)]
    pub role: String,
    #[serde(skip)]
    pub is_git: bool,
    #[serde(skip)]
    pub remote_url: Option<String>,
    #[serde(skip)]
    pub branch: Option<String>,
    #[serde(skip)]
    pub head_commit: Option<String>,
    #[serde(skip)]
    pub head_summary: Option<String>,
    #[serde(skip)]
    pub dirty: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct ProjectRepository {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub source_root: String,
    pub git_common_dir: String,
    pub source_ownership: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repository_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preferred_remote_name: Option<String>,
    pub delivery_mode: Option<String>,
    pub setup_command: String,
    pub setup_workdir: String,
    pub git_status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_checked_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProjectDirectory {
    pub id: String,
    pub project_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repository_id: Option<String>,
    pub name: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relative_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub external_path: Option<String>,
    pub path: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub description: String,
    pub status: String,
    pub location_count: i64,
    pub git_location_count: i64,
    pub context_location_count: i64,
    pub missing_location_count: i64,
    pub abnormal_location_count: i64,
    pub active_workspace_count: i64,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct ProjectDetail {
    #[serde(flatten)]
    pub project: Project,
    pub repositories: Vec<ProjectRepository>,
    pub directories: Vec<ProjectDirectory>,
    pub sessions: Vec<Session>,
    pub workspaces: Vec<Workspace>,
    pub worktrees: Vec<GitWorktree>,
}
