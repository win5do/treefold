use serde::Deserialize;

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GenerationRequest {
    pub repository_kind: String,
    pub repository_id: String,
    pub source: GenerationSource,
}
#[derive(Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum GenerationSource {
    Staged {
        expected_snapshot: String,
    },
    History {
        commits: Vec<String>,
        expected_head: String,
    },
    Delivery {
        expected_head: String,
        expected_target_head: String,
    },
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TestGenerationRequest {
    pub command: String,
}
