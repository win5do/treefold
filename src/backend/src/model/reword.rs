use super::GitHistory;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum RewordRequest {
    Preview {
        expected_head: String,
    },
    Apply {
        expected_head: String,
        expected_branch: String,
        message: String,
        #[serde(default)]
        confirmed_refs: Vec<String>,
    },
}

#[derive(Debug, Serialize)]
pub struct RewordPreview {
    pub head: String,
    pub branch: String,
    pub message: String,
    pub shared_refs: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct RewordResponse {
    pub preview: Option<RewordPreview>,
    pub history: Option<GitHistory>,
}
