use serde::{Deserialize, Serialize};

use super::{Project, ProjectDirectory, ProjectRepository};
#[derive(Clone, Debug, Serialize)]
pub struct SidebarData {
    pub projects: Vec<SidebarProject>,
}

#[derive(Clone, Debug, Serialize)]
pub struct SidebarProject {
    #[serde(flatten)]
    pub project: Project,
    pub repositories: Vec<ProjectRepository>,
    pub directories: Vec<ProjectDirectory>,
    pub sessions: Vec<Session>,
    pub workspaces: Vec<SidebarWorkspace>,
}

#[derive(Clone, Debug, Serialize)]
pub struct SidebarWorkspace {
    #[serde(flatten)]
    pub workspace: Workspace,
    pub sessions: Vec<Session>,
    pub repositories: Vec<WorkspaceRepository>,
    pub directories: Vec<WorkspaceDirectory>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub description: String,
    pub status: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_workspace_id: Option<String>,
    pub runtime_id: String,
    pub runtime_name: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip)]
    pub checkout_mode: String,
    #[serde(skip)]
    pub project_directory_id: String,
    #[serde(skip)]
    pub worktree_id: Option<String>,
    #[serde(skip)]
    pub checkout_path: String,
    #[serde(skip)]
    pub target_branch: String,
    #[serde(skip)]
    pub start_commit: String,
    #[serde(skip)]
    pub branch: String,
    #[serde(skip)]
    pub forked_from_commit: Option<String>,
    #[serde(skip)]
    pub remote_name: Option<String>,
    #[serde(skip)]
    pub remote_branch: Option<String>,
    #[serde(skip)]
    pub branch_ownership: String,
    #[serde(skip)]
    pub delivery_status: String,
    #[serde(skip)]
    pub close_outcome: Option<String>,
    #[serde(skip)]
    pub integrated_commit: Option<String>,
    #[serde(skip)]
    pub closed_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct WorkspaceRepository {
    pub id: String,
    pub workspace_id: String,
    pub project_repository_id: String,
    pub repository_name: String,
    pub source_root: String,
    pub access_mode: String,
    pub git_status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub creation_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checkout_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_commit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub forked_from_commit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_branch: Option<String>,
    pub worktree_ownership: String,
    pub branch_ownership: String,
    pub delivery_status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub close_outcome: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub integrated_commit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub closed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WorkspaceDirectory {
    pub id: String,
    pub workspace_id: String,
    pub project_directory_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_repository_id: Option<String>,
    pub name: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relative_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub external_path: Option<String>,
    pub path: String,
    pub access_mode: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub kind: String,
    pub cwd: String,
    pub original_cwd: String,
    pub initial_prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codex_session_id: Option<String>,
    pub visibility: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hidden_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evicted_at: Option<String>,
    pub amux_workspace_name: String,
    pub amux_process_name: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i64>,
    pub exit_signal: String,
    pub argv: Vec<String>,
    pub io_mode: String,
    pub launch_started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_attached_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub additional_directories: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct Todo {
    pub id: String,
    pub workspace_id: String,
    pub content: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fork_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocked_reason: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct WorkspaceDetail {
    #[serde(flatten)]
    pub workspace: Workspace,
    pub project: Project,
    pub repositories: Vec<WorkspaceRepository>,
    pub directories: Vec<WorkspaceDirectory>,
    pub sessions: Vec<Session>,
    pub todos: Vec<Todo>,
    pub forks: Vec<Workspace>,
    pub finish_batch: Option<super::FinishBatch>,
}
