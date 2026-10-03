//! Metadata contracts carry launch evidence, never database or HTTP state.
use anyhow::Result;
use serde_json::Value;
use std::{
    io::{BufRead, BufReader, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};

pub struct MetadataContext<'a> {
    pub session_id: &'a str,
    pub original_cwd: &'a str,
    pub argv: &'a [String],
    pub native_id: Option<&'a str>,
    pub runtime_dir: &'a Path,
    pub read_title: bool,
}
#[derive(Default, Debug)]
pub struct AgentMetadata {
    pub id: Option<String>,
    pub title: Option<String>,
}

pub fn runtime_dir(home: &Path, kind: &str, id: &str) -> PathBuf {
    home.join("data/agent-sessions").join(kind).join(id)
}

pub(super) fn argument<'a>(argv: &'a [String], option: &str) -> Option<&'a str> {
    argv.windows(2)
        .find(|pair| pair[0] == option)
        .map(|pair| pair[1].as_str())
}
pub(super) fn json_lines(path: &Path) -> Vec<Value> {
    const WINDOW: u64 = 8 * 1024 * 1024;
    let Ok(mut file) = std::fs::File::open(path) else {
        return vec![];
    };
    let length = file.metadata().map(|meta| meta.len()).unwrap_or(0);
    let mut values: Vec<Value> = BufReader::new(Read::by_ref(&mut file).take(WINDOW))
        .lines()
        .map_while(Result::ok)
        .filter_map(|line| serde_json::from_str(&line).ok())
        .collect();
    // Identity is in the header; titles may be appended after a long conversation.
    if length > WINDOW {
        let offset = length.saturating_sub(WINDOW).max(WINDOW);
        if file.seek(SeekFrom::Start(offset)).is_ok() {
            let mut tail = BufReader::new(file.take(WINDOW));
            let mut partial = String::new();
            let _ = tail.read_line(&mut partial); // offset may be inside a JSON record
            values.extend(
                tail.lines()
                    .map_while(Result::ok)
                    .filter_map(|line| serde_json::from_str(&line).ok()),
            );
        }
    }
    values
}
pub(super) fn write_private(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("missing runtime directory"))?;
    std::fs::create_dir_all(parent)?;
    let mut file = tempfile::NamedTempFile::new_in(parent)?;
    file.write_all(bytes)?;
    file.as_file().sync_all()?;
    file.persist(path)?;
    Ok(())
}
