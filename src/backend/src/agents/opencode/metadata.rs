use crate::agents::{AgentMetadata, MetadataContext};
use std::io::Read;

pub(super) fn read(context: &MetadataContext<'_>) -> AgentMetadata {
    let Ok(file) = std::fs::File::open(context.runtime_dir.join("metadata.json")) else {
        return AgentMetadata::default();
    };
    let Ok(value) = serde_json::from_reader::<_, serde_json::Value>(file.take(64 * 1024)) else {
        return AgentMetadata::default();
    };
    let id = value["id"].as_str().filter(|id| {
        id.starts_with("ses_") && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
    });
    if context.native_id.is_some_and(|saved| Some(saved) != id) {
        return AgentMetadata::default();
    }
    let title = value["title"].as_str().filter(|title| {
        !title.starts_with("New session - ") && !title.starts_with("Child session - ")
    });
    AgentMetadata {
        id: id.map(str::to_owned),
        title: if context.read_title {
            title.map(str::to_owned)
        } else {
            None
        },
    }
}
