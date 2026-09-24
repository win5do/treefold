use serde::{Deserialize, Serialize};

use super::{GitCommit, WorkspaceRepository};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeliveryPreflight {
    pub id: String,
    pub workspace_repository_id: String,
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

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeliveryOperation {
    pub workspace_repository_id: String,
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
pub struct ParentOperation {
    pub id: String,
    pub workspace_repository_id: String,
    pub workspace_id: String,
    pub direction: String,
    pub strategy: String,
    pub origin: String,
    pub source_repository_id: String,
    pub source_path: String,
    pub source_branch: String,
    pub target_scope: String,
    pub target_workspace_id: Option<String>,
    pub target_path: String,
    pub target_branch: String,
    pub source_head: String,
    pub parent_head: String,
    pub before_head: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_head: Option<String>,
    pub recovery_ref: String,
    pub status: String,
    pub phase: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolver_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delivery_operation_id: Option<String>,
    pub error: String,
    pub started_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ParentOperationPreview {
    pub direction: String,
    pub repository_name: String,
    pub source_path: String,
    pub source_branch: String,
    pub target_scope: String,
    pub target_path: String,
    pub target_branch: String,
    pub source_head: String,
    pub parent_head: String,
    pub outcome: String,
    pub blockers: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation: Option<ParentOperation>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FinishProgress {
    pub status: String,
    pub repository: WorkspaceRepository,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation: Option<ParentOperation>,
}
