//! Metadata contracts carry launch evidence, never database or HTTP state.
use anyhow::Result;
use std::{
    io::Write,
    path::{Path, PathBuf},
};

pub struct MetadataContext<'a> {
    pub session_id: &'a str,
    pub native_id: Option<&'a str>,
    pub runtime_dir: &'a Path,
}
#[derive(Default, Debug)]
pub struct AgentMetadata {
    pub id: Option<String>,
}

pub fn runtime_dir(home: &Path, kind: &str, id: &str) -> PathBuf {
    home.join("data/agent-sessions").join(kind).join(id)
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
