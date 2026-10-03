use crate::agents::{
    AgentMetadata, MetadataContext,
    metadata::{argument, json_lines},
};
use std::path::Path;

pub(super) fn read(context: &MetadataContext<'_>) -> AgentMetadata {
    let expected = context.runtime_dir.join("session.jsonl");
    if argument(context.argv, "--session").map(Path::new) != Some(expected.as_path()) {
        return AgentMetadata::default();
    }
    let entries = json_lines(&expected);
    let Some(header) = entries.first().filter(|header| header["type"] == "session") else {
        return AgentMetadata::default();
    };
    let id = header["id"]
        .as_str()
        .filter(|id| uuid::Uuid::parse_str(id).is_ok());
    if context.native_id.is_some_and(|saved| Some(saved) != id) {
        return AgentMetadata::default();
    }
    let title = if context.read_title {
        entries.iter().rev().find_map(|entry| {
            (entry["type"] == "session_info")
                .then(|| entry["name"].as_str())
                .flatten()
                .map(str::to_owned)
        })
    } else {
        None
    };
    AgentMetadata {
        id: id.map(str::to_owned),
        title,
    }
}
