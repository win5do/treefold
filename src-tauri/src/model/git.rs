use serde::{Deserialize, Serialize};
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
