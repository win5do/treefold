use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Serialize)]
pub struct GitWorktree {
    pub project_repository_id: String,
    pub repository_name: String,
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
pub struct GitChangeFile {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
    pub status: String,
    pub staged: bool,
    pub has_staged_changes: bool,
    pub has_unstaged_changes: bool,
    pub additions: usize,
    pub deletions: usize,
    pub binary: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct GitStatus {
    pub branch: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head: Option<String>,
    pub files: Vec<GitChangeFile>,
    pub staged_count: usize,
    pub unstaged_count: usize,
    pub snapshot: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct GitPathsInput {
    pub paths: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct GitCommitInput {
    pub message: String,
    pub expected_snapshot: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct GitCommitTargetInput {
    pub commit: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum GitResetMode {
    Soft,
    Mixed,
    Hard,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct GitResetCommitInput {
    pub commit: String,
    pub mode: GitResetMode,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct GitCommitResult {
    pub hash: String,
    pub status: GitStatus,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(tag = "scope", rename_all = "kebab-case")]
pub enum GitDiffRequest {
    Staged {
        path: Option<String>,
    },
    Unstaged {
        path: Option<String>,
    },
    Commit {
        start_commit: String,
        end_commit: String,
        commit_count: usize,
        path: Option<String>,
    },
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
    pub project_repository_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_repository_id: Option<String>,
    pub repository_name: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<GitSyncResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}
