use crate::agents::LaunchContext;
use anyhow::{Context, Result};
use std::io::{BufRead, BufReader, Read, Write};

pub(super) fn prepare(context: &LaunchContext<'_>) -> Result<()> {
    let directory = context
        .runtime_dir
        .context("Pi requires a managed runtime directory")?;
    if let Some(id) = context.resume_id {
        relocate(&directory.join("session.jsonl"), id, context.cwd)?;
    }
    Ok(())
}

// Called only after the old managed process has stopped. This application-owned
// history file is Pi's cwd authority; changing the child process cwd is insufficient.
fn relocate(path: &std::path::Path, id: &str, cwd: &str) -> Result<()> {
    let mut source = BufReader::new(std::fs::File::open(path)?);
    let mut line = String::new();
    Read::by_ref(&mut source)
        .take(1024 * 1024)
        .read_line(&mut line)?;
    anyhow::ensure!(
        line.ends_with('\n'),
        "Pi session header is incomplete or too large"
    );
    let mut header: serde_json::Value = serde_json::from_str(&line)?;
    anyhow::ensure!(
        header["type"] == "session" && header["id"].as_str() == Some(id),
        "Pi session identity changed before launch"
    );
    if header["cwd"].as_str() == Some(cwd) {
        return Ok(());
    }
    header["cwd"] = cwd.into();
    let mut target =
        tempfile::NamedTempFile::new_in(path.parent().context("Missing Pi runtime directory")?)?;
    serde_json::to_writer(&mut target, &header)?;
    target.write_all(b"\n")?;
    std::io::copy(&mut source, &mut target)?;
    target.as_file().sync_all()?;
    target.persist(path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resume_relocates_native_cwd_without_changing_identity_or_transcript() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("session.jsonl");
        let body = b"{\"type\":\"message\",\"id\":\"a\",\"text\":\"keep exact bytes\"}\npartial";
        let mut original = b"{\"type\":\"session\",\"version\":3,\"id\":\"native-id\",\"cwd\":\"/removed-worktree\"}\n".to_vec();
        original.extend_from_slice(body);
        std::fs::write(&path, &original).unwrap();
        assert!(relocate(&path, "wrong-id", "/source").is_err());
        assert_eq!(std::fs::read(&path).unwrap(), original);
        relocate(&path, "native-id", "/source").unwrap();
        let updated = std::fs::read(&path).unwrap();
        let boundary = updated.iter().position(|b| *b == b'\n').unwrap();
        let header: serde_json::Value = serde_json::from_slice(&updated[..boundary]).unwrap();
        assert_eq!(header["cwd"], "/source");
        assert_eq!(header["id"], "native-id");
        assert_eq!(header["version"], 3);
        assert_eq!(&updated[boundary + 1..], body);
        relocate(&path, "native-id", "/source").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), updated);
    }
}
