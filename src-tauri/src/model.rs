#![allow(dead_code)] // Internal compatibility fields are skipped by the Repository-first API.

use serde::{Deserialize, Serialize};

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
    pub default_base_branch: String,
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
    #[serde(skip)]
    pub default_target_branch: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProjectLocation {
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
    pub base_branch: Option<String>,
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

pub type Directory = ProjectLocation;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProjectRepository {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub source_root: String,
    pub git_common_dir: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repository_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preferred_remote_name: Option<String>,
    pub base_branch: String,
    pub delivery_mode: String,
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
    pub repositories: Vec<WorkspaceLocation>,
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
    pub delivery_mode: String,
    #[serde(skip)]
    pub delivery_status: String,
    #[serde(skip)]
    pub close_outcome: Option<String>,
    #[serde(skip)]
    pub integrated_commit: Option<String>,
    #[serde(skip)]
    pub closed_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WorkspaceLocation {
    pub id: String,
    pub workspace_id: String,
    pub project_location_id: String,
    pub location_name: String,
    pub source_path: String,
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
    pub branch_ownership: String,
    pub delivery_mode: String,
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

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Todo {
    pub id: String,
    pub workspace_id: String,
    pub title: String,
    pub description: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocked_reason: Option<String>,
    pub created_at: String,
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

#[derive(Clone, Debug, Serialize)]
pub struct GitWorktree {
    pub project_location_id: String,
    pub location_name: String,
    pub path: String,
    pub branch: String,
    pub head_commit: String,
    pub is_main: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_name: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct GitCommit {
    pub hash: String,
    pub short_hash: String,
    pub subject: String,
    pub author: String,
    pub authored_at: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct GitHistory {
    pub branch: String,
    pub commits: Vec<GitCommit>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct GitDiffComparisonInput {
    pub start_commit: String,
    pub end_commit: String,
    pub commit_count: usize,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct GitDiffComparison {
    pub repository: String,
    pub resolved_base: String,
    pub resolved_head: String,
    pub commit_count: usize,
    pub patch: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct ReconciliationIssue {
    pub id: String,
    pub kind: String,
    pub severity: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    pub actions: Vec<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct ReconciliationReport {
    pub project_id: String,
    pub checked_at: String,
    pub issues: Vec<ReconciliationIssue>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct RepairResult {
    pub action: String,
    pub changed: bool,
    pub report: ReconciliationReport,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeliveryPreflight {
    pub id: String,
    pub workspace_location_id: String,
    #[serde(skip)]
    pub workspace_id: String,
    pub code_action: String,
    pub source_head: String,
    pub target_head: String,
    pub target_branch: String,
    pub source_status: String,
    pub source_dirty: bool,
    pub target_dirty: bool,
    pub ahead: i64,
    pub behind: i64,
    pub changed_files: Vec<String>,
    pub commits: Vec<GitCommit>,
    pub diff_stat: String,
    pub blockers: Vec<String>,
    pub warnings: Vec<String>,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct WorkspaceDetail {
    #[serde(flatten)]
    pub workspace: Workspace,
    pub project: Project,
    pub repositories: Vec<WorkspaceLocation>,
    pub directories: Vec<WorkspaceDirectory>,
    pub sessions: Vec<Session>,
    pub todos: Vec<Todo>,
    pub forks: Vec<Workspace>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct GitSyncResult {
    pub scope: String,
    pub action: String,
    pub branch: String,
    pub remote: String,
    pub remote_branch: String,
    pub before_head: String,
    pub after_head: String,
    pub status: String,
    pub message: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct GitSyncItemResult {
    pub project_location_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_location_id: Option<String>,
    pub location_name: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<GitSyncResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeliveryOperation {
    pub workspace_location_id: String,
    pub workspace_id: String,
    pub phase: String,
    pub code_action: String,
    pub todo_action: String,
    pub push_after_merge: bool,
    pub keep_session_history: bool,
    pub delete_worktree: bool,
    pub delete_branch: bool,
    pub commit_message: String,
    pub before_head: String,
    pub source_head: String,
    pub target_head: String,
    pub integrated_commit: Option<String>,
    pub error: String,
    pub started_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct RebaseOperation {
    pub id: String,
    pub workspace_location_id: String,
    #[serde(skip)]
    pub workspace_id: String,
    pub status: String,
    pub phase: String,
    pub before_head: String,
    pub target_head: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rebased_head: Option<String>,
    pub recovery_ref: String,
    pub error: String,
    pub started_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ResetOperation {
    pub id: String,
    pub workspace_location_id: String,
    #[serde(skip)]
    pub workspace_id: String,
    pub status: String,
    pub mode: String,
    pub before_head: String,
    pub target_head: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_head: Option<String>,
    pub recovery_ref: String,
    pub error: String,
    pub started_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
}
