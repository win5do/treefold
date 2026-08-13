use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub description: String,
    pub status: String,
    pub primary_directory_id: String,
    pub git_common_dir: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preferred_remote: Option<String>,
    pub default_target_branch: String,
    pub default_delivery_mode: String,
    pub created_at: String,
    pub updated_at: String,
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
    pub checkout_path: Option<String>,
    pub role: String,
    pub is_git: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head_commit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head_summary: Option<String>,
    pub dirty: bool,
    pub created_at: String,
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
    pub checkout_mode: String,
    pub project_directory_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_id: Option<String>,
    pub checkout_path: String,
    pub target_branch: String,
    pub start_commit: String,
    pub branch: String,
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
    pub runtime_id: String,
    pub runtime_name: String,
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
    pub yolo: bool,
    pub sidebar_visible: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hidden_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evicted_at: Option<String>,
    pub process_id: String,
    pub process_name: String,
    pub status: String,
    pub pid: i64,
    pub process_group_id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i64>,
    pub exit_signal: String,
    pub command: Vec<String>,
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
    pub directories: Vec<Directory>,
    pub workspaces: Vec<Workspace>,
    pub worktrees: Vec<GitWorktree>,
}

#[derive(Clone, Debug, Serialize)]
pub struct GitWorktree {
    pub directory_id: String,
    pub directory_name: String,
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
    pub directories: Vec<Directory>,
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

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeliveryOperation {
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

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct GitOperationRecord {
    pub id: String,
    pub kind: String,
    pub action: String,
    pub status: String,
    pub before_head: String,
    pub target_head: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_head: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recovery_ref: Option<String>,
    pub error: String,
    pub started_at: String,
    pub updated_at: String,
}
