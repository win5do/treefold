use serde_json::Value;
#[cfg(test)]
use serde_json::json;
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read},
    path::Path,
};
pub(super) fn scan(home: &Path, sessions: &[(String, String)]) -> HashMap<String, String> {
    let mut directories = vec![home.join("sessions")];
    let mut found: HashMap<String, Option<String>> = HashMap::new();
    while let Some(directory) = directories.pop() {
        let Ok(entries) = std::fs::read_dir(directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            let path = entry.path();
            if kind.is_dir() {
                directories.push(path);
                continue;
            }
            if !kind.is_file() || path.extension().and_then(|s| s.to_str()) != Some("jsonl") {
                continue;
            }
            let Ok(file) = std::fs::File::open(path) else {
                continue;
            };
            // Startup context precedes user turns. Bound reads even for large histories.
            let mut lines = BufReader::new(file.take(2 * 1024 * 1024)).lines();
            let Some(Ok(line)) = lines.next() else {
                continue;
            };
            let Ok(meta) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if meta["type"] != "session_meta" {
                continue;
            }
            let payload = &meta["payload"];
            let Some(codex_id) = payload["session_id"]
                .as_str()
                .or_else(|| payload["id"].as_str())
            else {
                continue;
            };
            let candidates: Vec<_> = sessions
                .iter()
                .filter(|session| payload["cwd"].as_str() == Some(session.1.as_str()))
                .collect();
            if candidates.is_empty() {
                continue;
            }
            for line in lines.take(64).map_while(std::result::Result::ok) {
                let Ok(value) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                if value["type"] != "response_item" || value["payload"]["role"] != "developer" {
                    continue;
                }
                let Some(content) = value["payload"]["content"].as_array() else {
                    continue;
                };
                for part in content {
                    let Some(id) = part["text"].as_str().and_then(context_session_id) else {
                        continue;
                    };
                    if !candidates.iter().any(|session| session.0 == id) {
                        continue;
                    }
                    found
                        .entry(id)
                        .and_modify(|current| {
                            if current.as_deref() != Some(codex_id) {
                                *current = None;
                            }
                        })
                        .or_insert_with(|| Some(codex_id.to_owned()));
                }
            }
        }
    }
    found
        .into_iter()
        .filter_map(|(key, value)| value.map(|id| (key, id)))
        .collect()
}

fn context_session_id(text: &str) -> Option<String> {
    let json = text
        .split_once("<treefold_runtime_context>")?
        .1
        .split_once("</treefold_runtime_context>")?
        .0;
    let value: Value = serde_json::from_str(json).ok()?;
    value["session"]["id"].as_str().map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delayed_context_matches_exact_session_and_ambiguous_files_are_rejected() {
        let home = tempfile::tempdir().unwrap();
        let directory = home.path().join("sessions");
        std::fs::create_dir(&directory).unwrap();
        let targets = vec![("managed".into(), "/work".into())];
        let meta = |id: &str| {
            format!(
                "{}\n",
                json!({"type":"session_meta", "payload":{"id":id,"cwd":"/work"}})
            )
        };
        let context = |role: &str| {
            format!(
                "{}\n",
                json!({"type":"response_item", "payload":{"role":role,"content":[{"text":"<treefold_runtime_context>{\"session\":{\"id\":\"managed\"}}</treefold_runtime_context>"}]}})
            )
        };
        std::fs::write(
            directory.join("ghostty.jsonl"),
            meta("unrelated") + &context("user"),
        )
        .unwrap();
        let path = directory.join("managed.jsonl");
        std::fs::write(&path, meta("correct")).unwrap();
        assert!(scan(home.path(), &targets).is_empty());
        std::fs::write(&path, meta("correct") + &context("developer")).unwrap();
        assert_eq!(
            scan(home.path(), &targets)
                .get("managed")
                .map(String::as_str),
            Some("correct")
        );
        std::fs::write(
            directory.join("duplicate.jsonl"),
            meta("ambiguous") + &context("developer"),
        )
        .unwrap();
        assert!(scan(home.path(), &targets).is_empty());
    }

    #[test]
    fn only_generated_context_supplies_identity() {
        assert_eq!(context_session_id("arbitrary id: session-1"), None);
        assert_eq!(
            context_session_id("<treefold_runtime_context>broken</treefold_runtime_context>"),
            None
        );
        assert_eq!(
            context_session_id(
                "prefix <treefold_runtime_context>\n{\"session\":{\"id\":\"session-1\"}}\n</treefold_runtime_context>"
            ),
            Some("session-1".into())
        );
    }
}
