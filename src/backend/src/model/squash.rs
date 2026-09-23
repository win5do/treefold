use super::GitHistory;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum SquashRequest {
    Preview {
        commits: Vec<String>,
        expected_head: String,
    },
    Apply {
        commits: Vec<String>,
        expected_head: String,
        message: String,
    },
    Undo {
        recovery_id: String,
        expected_head: String,
    },
}

#[derive(Clone, Debug, Serialize)]
pub struct SquashPreview {
    pub base: String,
    pub branch: String,
    pub selected_count: usize,
    pub replayed_count: usize,
    pub shared_branches: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct SquashResponse {
    pub preview: Option<SquashPreview>,
    pub history: Option<GitHistory>,
    pub recovery_id: Option<String>,
}
