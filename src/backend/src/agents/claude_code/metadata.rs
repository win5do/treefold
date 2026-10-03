use crate::agents::{
    AgentMetadata, MetadataContext,
    metadata::{argument, json_lines},
};
use std::path::{Path, PathBuf};

pub(super) fn read(context: &MetadataContext<'_>) -> AgentMetadata {
    let id = context
        .native_id
        .or_else(|| argument(context.argv, "--session-id"));
    let Some(id) = id.filter(|id| uuid::Uuid::parse_str(id).is_ok()) else {
        return AgentMetadata::default();
    };
    let home = std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".claude")));
    let Some(home) = home else {
        return AgentMetadata::default();
    };
    read_in(&home.join("projects"), id, context.read_title)
}

fn read_in(projects: &Path, id: &str, read_title: bool) -> AgentMetadata {
    // A UUID explicitly supplied at launch is exact evidence, including after cwd moves.
    let Ok(directories) = std::fs::read_dir(projects) else {
        return AgentMetadata::default();
    };
    for directory in directories.flatten() {
        if !directory.file_type().is_ok_and(|kind| kind.is_dir()) {
            continue;
        }
        let path = directory.path().join(format!("{id}.jsonl"));
        let entries = json_lines(&path);
        if !entries
            .iter()
            .any(|entry| entry["sessionId"].as_str() == Some(id))
        {
            continue;
        }
        let title = read_title
            .then(|| {
                entries
                    .iter()
                    .rev()
                    .find_map(|entry| {
                        (entry["type"] == "custom-title" && entry["sessionId"].as_str() == Some(id))
                            .then(|| entry["customTitle"].as_str())
                            .flatten()
                    })
                    .or_else(|| {
                        entries.iter().rev().find_map(|entry| {
                            (entry["type"] == "summary")
                                .then(|| entry["summary"].as_str())
                                .flatten()
                        })
                    })
                    .map(str::to_owned)
            })
            .flatten();
        return AgentMetadata {
            id: Some(id.into()),
            title,
        };
    }
    AgentMetadata::default()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_the_explicit_transcript_supplies_identity_and_title() {
        let root = tempfile::tempdir().unwrap();
        let project = root.path().join("project");
        std::fs::create_dir(&project).unwrap();
        let id = "01a08fff-908b-76b2-8c1c-3826e810b018";
        let path = project.join(format!("{id}.jsonl"));
        std::fs::write(&path, "{\"sessionId\":\"unrelated\"}\n").unwrap();
        assert!(read_in(root.path(), id, true).id.is_none());
        std::fs::write(&path, format!("{{\"sessionId\":\"{id}\",\"type\":\"user\"}}\n{{\"sessionId\":\"{id}\",\"type\":\"custom-title\",\"customTitle\":\"My task\"}}\n")).unwrap();
        let result = read_in(root.path(), id, true);
        assert_eq!(result.id.as_deref(), Some(id));
        assert_eq!(result.title.as_deref(), Some("My task"));
    }
}
