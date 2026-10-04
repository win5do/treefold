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

pub(super) async fn capture(state: &AppState, flush: bool) -> Result<()> {
    let mut observer = state.runtime.title_observer.lock().await;
    let processes = state.terminals.process_snapshot().await;
    let mut present = std::collections::HashSet::new();
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
            collect(state, &process, &session.kind, id, cursor),
        )
        .await;
        match result {
            Ok(Ok(())) => {
                if ["exited", "failed", "stopped"].contains(&process.state.as_str()) {
                    cursor.finished = true;
                    // Include the last output before committing the stopped Session's title.
                    state.store.persist_terminal_titles(true).await?;
                }
            }
            Ok(Err(error)) => log::debug!("terminal title observation for {id}: {error}"),
            Err(_) => log::debug!("terminal title observation timed out for {id}"),
        }
    }
    observer.processes.retain(|key, _| present.contains(key));
    state.store.persist_terminal_titles(flush).await
}

async fn collect(
    state: &AppState,
    process: &TreefoldProcessView,
    kind: &str,
    id: &str,
    cursor: &mut Cursor,
) -> anyhow::Result<()> {
    let body = state
        .terminals
        .passive_logs(&process.workspace_name, &process.name, cursor.sequence)
        .await?;
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
                if state
                    .store
                    .titles
                    .update(id, title, std::time::Instant::now())
                {
                    state.runtime.publish_session_list(Some(id.into()));
                }
            }
        }
        anyhow::ensure!(
            pending.len() <= 1024 * 1024,
            "oversized terminal log record"
        );
    }
    Ok(())
}
