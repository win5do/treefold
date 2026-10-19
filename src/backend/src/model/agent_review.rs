use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct AgentReviewContext {
    pub repositories: Vec<AgentReviewRepository>,
}

#[derive(Debug, Serialize)]
pub struct AgentReviewRepository {
    pub repository_id: String,
    pub name: String,
    pub current_path: String,
    pub current_branch: String,
    pub current_head: String,
    pub target_path: String,
    pub target_branch: String,
    pub target_head: String,
    pub merge_base: String,
}
