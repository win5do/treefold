use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FinishPlanItem {
    pub repository_id: String,
    pub code_action: String,
    pub delete_worktree: bool,
    pub delete_branch: bool,
    pub preflight_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FinishBatchItem {
    #[serde(flatten)]
    pub plan: FinishPlanItem,
    pub repository_name: String,
    pub status: String,
    pub delivered: bool,
    pub cleaned: bool,
    pub error: Option<String>,
    #[serde(default)]
    pub error_code: Option<String>,
    pub operation_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FinishBatch {
    pub workspace_id: String,
    pub status: String,
    pub items: Vec<FinishBatchItem>,
    pub error: Option<String>,
}
