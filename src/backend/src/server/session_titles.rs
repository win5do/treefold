//! Observe amux output even when no renderer has this terminal mounted.
use super::*;
use crate::terminal::TreefoldProcessView;
use base64::Engine;
use futures_util::StreamExt;
use std::collections::HashMap;

#[derive(Default)]
pub(super) struct Observer {
    processes: HashMap<String, Cursor>,
}
#[derive(Default)]
struct Cursor {
    sequence: u64,
    parser: crate::session_title::Parser,
    finished: bool,
}

#[derive(Default)]
struct TitleUpdates(HashMap<String, String>);

impl TitleUpdates {
    fn publish(self, titles: &crate::session_title::TitleCache, runtime: &RuntimeHub) {
        let mut changed = false;
        for (id, title) in self.0 {
            changed |= titles.update(&id, title, std::time::Instant::now());
        }
        if changed {
            runtime.publish_session_list(None);
        }
    }
}

pub(super) async fn capture(state: &AppState, flush: bool) -> Result<()> {
    let mut observer = state.runtime.title_observer.lock().await;
    let processes = state.terminals.process_snapshot().await;
    let mut present = std::collections::HashSet::new();
    let mut updates = TitleUpdates::default();
    let mut persist = flush;
    for process in processes {
        if !process.session_root || process.io_mode != "tty" {
            continue;
        }
        let Some(id) = process.session_id.as_deref() else {
            continue;
        };
        let key = format!("{}:{}", process.id, process.execution);
        present.insert(key.clone());
        let cursor = observer.processes.entry(key).or_default();
        if cursor.finished {
            continue;
        }
        let Ok(session) = state.store.session(id).await else {
            continue;
        };
        let result = tokio::time::timeout(
            Duration::from_secs(3),
            collect(state, &process, &session.kind, id, cursor, &mut updates),
        )
        .await;
        match result {
            Ok(Ok(())) => {
                if ["exited", "failed", "stopped"].contains(&process.state.as_str()) {
                    cursor.finished = true;
                    // Include the last output before committing the stopped Session's title.
                    persist = true;
                }
            }
            Ok(Err(error)) => log::warn!("terminal title observation for {id}: {error}"),
            Err(_) => log::warn!("terminal title observation timed out for {id}"),
        }
    }
    observer.processes.retain(|key, _| present.contains(key));
    // Historical output is a snapshot, not thousands of live title changes.
    // Keep updates outside the timed future so partial progress is published too.
    updates.publish(&state.store.titles, &state.runtime);
    state.store.persist_terminal_titles(persist).await
}

async fn collect(
    state: &AppState,
    process: &TreefoldProcessView,
    kind: &str,
    id: &str,
    cursor: &mut Cursor,
    updates: &mut TitleUpdates,
) -> anyhow::Result<()> {
    let body = state
        .terminals
        .passive_logs(&process.workspace_name, &process.name, cursor.sequence)
        .await?;
    collect_output(body, process, kind, id, cursor, updates).await
}

async fn collect_output(
    body: axum::body::Body,
    process: &TreefoldProcessView,
    kind: &str,
    id: &str,
    cursor: &mut Cursor,
    updates: &mut TitleUpdates,
) -> anyhow::Result<()> {
    let mut stream = body.into_data_stream();
    let mut pending = Vec::new();
    while let Some(chunk) = stream.next().await {
        pending.extend_from_slice(&chunk?);
        while let Some(end) = pending.iter().position(|byte| *byte == b'\n') {
            let line: Vec<_> = pending.drain(..=end).collect();
            let value: Value = serde_json::from_slice(&line)?;
            if value["type"] == "gap" {
                cursor.parser.reset();
                continue;
            }
            let event: amux::model::OutputEvent = serde_json::from_value(value)?;
            if event.sequence <= cursor.sequence {
                continue;
            }
            cursor.sequence = event.sequence;
            if event.execution != process.execution {
                continue;
            }
            let Some(data) = event.data else {
                cursor.parser.reset();
                continue;
            };
            let bytes = match data.encoding.as_str() {
                "utf8" => data.text.into_bytes(),
                "base64" => base64::engine::general_purpose::STANDARD.decode(data.base64)?,
                _ => {
                    cursor.parser.reset();
                    continue;
                }
            };
            for title in cursor.parser.feed(&bytes, kind) {
                if kind == "pi"
                    && std::path::Path::new(&process.cwd)
                        .file_name()
                        .and_then(|value| value.to_str())
                        == Some(title.as_str())
                {
                    continue;
                }
                updates.0.insert(id.into(), title);
            }
        }
        anyhow::ensure!(
            pending.len() <= 1024 * 1024,
            "oversized terminal log record"
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::{Body, Bytes};

    fn process() -> TreefoldProcessView {
        TreefoldProcessView {
            id: "process".into(),
            workspace_id: "workspace".into(),
            group_id: "group".into(),
            parent_process_id: None,
            session_id: Some("session".into()),
            session_root: true,
            workspace_name: "workspace".into(),
            name: "session".into(),
            command: vec![],
            cwd: "/tmp/project".into(),
            io_mode: "tty".into(),
            state: "exited".into(),
            pid: 0,
            execution: 1,
            created_at: String::new(),
            started_at: None,
            finished_at: None,
            exit_code: Some(0),
            exit_signal: String::new(),
        }
    }

    fn output(sequence: u64, title: &str) -> String {
        let text = format!("\x1b]2;{title}\x07");
        format!(
            "{}\n",
            json!({
                "sequence": sequence, "execution": 1,
                "timestamp": "2026-10-15T09:47:00Z", "stream": "tty",
                "offset": 0, "length": text.len(),
                "data": { "encoding": "utf8", "text": text }
            })
        )
    }

    #[tokio::test]
    async fn historical_titles_publish_only_final_values_in_one_event() {
        let runtime = RuntimeHub::default();
        let titles = crate::session_title::TitleCache::default();
        let mut updates = TitleUpdates::default();
        let process = process();
        for id in ["first", "second"] {
            let history = (1..=10_000)
                .map(|n| output(n, &format!("title {n}")))
                .collect::<String>();
            let mut cursor = Cursor::default();
            collect_output(
                Body::from(history),
                &process,
                "codex",
                id,
                &mut cursor,
                &mut updates,
            )
            .await
            .unwrap();
            assert_eq!(cursor.sequence, 10_000);
            assert_eq!(titles.get(id), None);
        }
        let mut events = runtime.subscribe();
        updates.publish(&titles, &runtime);
        assert_eq!(titles.get("first").as_deref(), Some("title 10000"));
        assert_eq!(titles.get("second").as_deref(), Some("title 10000"));
        let change = events.try_recv().unwrap();
        assert_eq!(
            change.domains,
            vec![RuntimeDomain::Sidebar, RuntimeDomain::Sessions]
        );
        assert_eq!(change.session_id, None);
        assert!(events.try_recv().is_err());

        // Intermediate titles must not generate a change if the final title is unchanged.
        let mut same = TitleUpdates::default();
        collect_output(
            Body::from(output(1, "intermediate") + &output(2, "title 10000")),
            &process,
            "codex",
            "first",
            &mut Cursor::default(),
            &mut same,
        )
        .await
        .unwrap();
        same.publish(&titles, &runtime);
        assert_eq!(runtime.revision(), 1);
    }

    #[tokio::test]
    async fn timed_out_title_collection_keeps_progress_and_resumes_after_cursor() {
        let runtime = RuntimeHub::default();
        let titles = crate::session_title::TitleCache::default();
        let mut updates = TitleUpdates::default();
        let mut cursor = Cursor::default();
        let body = Body::from_stream(
            futures_util::stream::iter([Ok::<_, std::io::Error>(Bytes::from(output(
                1, "partial",
            )))])
            .chain(futures_util::stream::pending()),
        );
        assert!(
            tokio::time::timeout(
                Duration::from_millis(20),
                collect_output(
                    body,
                    &process(),
                    "codex",
                    "session",
                    &mut cursor,
                    &mut updates
                )
            )
            .await
            .is_err()
        );
        updates.publish(&titles, &runtime);
        assert_eq!(titles.get("session").as_deref(), Some("partial"));
        assert_eq!(cursor.sequence, 1);

        let mut resumed = TitleUpdates::default();
        collect_output(
            Body::from(output(1, "duplicate") + &output(2, "latest")),
            &process(),
            "codex",
            "session",
            &mut cursor,
            &mut resumed,
        )
        .await
        .unwrap();
        resumed.publish(&titles, &runtime);
        assert_eq!(titles.get("session").as_deref(), Some("latest"));
        assert_eq!(runtime.revision(), 2);
    }

    #[tokio::test]
    async fn malformed_output_does_not_discard_already_observed_titles() {
        let runtime = RuntimeHub::default();
        let titles = crate::session_title::TitleCache::default();
        let mut updates = TitleUpdates::default();
        assert!(
            collect_output(
                Body::from(output(1, "last valid") + "invalid json\n"),
                &process(),
                "codex",
                "session",
                &mut Cursor::default(),
                &mut updates
            )
            .await
            .is_err()
        );
        updates.publish(&titles, &runtime);
        assert_eq!(titles.get("session").as_deref(), Some("last valid"));
        assert_eq!(runtime.revision(), 1);
    }
}
