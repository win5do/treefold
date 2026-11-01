//! One-shot shell commands. Prompt bytes never enter shell source. Each command
//! owns a process group, killed on completion, timeout or cancellation, including
//! children retaining stdout after the shell exits. Output collection is bounded.
use anyhow::{Context, Result, bail};
use std::{path::Path, process::Stdio};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};

struct ProcessGroup(u32);
impl Drop for ProcessGroup {
    fn drop(&mut self) {
        // Child-created groups only; never signal Treefold's caller group.
        unsafe {
            libc::kill(-(self.0 as i32), libc::SIGKILL);
        }
    }
}

async fn collect(mut reader: impl AsyncRead + Unpin, limit: usize) -> Result<(String, bool)> {
    let mut bytes = Vec::new();
    let mut buffer = [0; 8192];
    let mut truncated = false;
    loop {
        let count = reader.read(&mut buffer).await?;
        if count == 0 {
            break;
        }
        let retained = count.min(limit.saturating_sub(bytes.len()));
        bytes.extend_from_slice(&buffer[..retained]);
        truncated |= retained < count;
    }
    Ok((String::from_utf8_lossy(&bytes).into_owned(), truncated))
}

/// Git context is bounded before constructing the prompt, including unusually
/// large generated files. Dropping this future terminates its owned Git process.
pub(crate) async fn git_output(cwd: &Path, args: &[&str]) -> Result<(String, bool)> {
    let mut child = tokio::process::Command::new("git")
        .args(args)
        .current_dir(cwd)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0)
        .kill_on_drop(true)
        .spawn()
        .context("Read Git context")?;
    let _group = ProcessGroup(child.id().context("Git process has no id")?);
    let stdout = child.stdout.take().context("Git stdout unavailable")?;
    let stderr = child.stderr.take().context("Git stderr unavailable")?;
    let ((stdout, truncated), (stderr, _), status) = tokio::try_join!(
        collect(stdout, 16 * 1024 * 1024),
        collect(stderr, 4096),
        async { child.wait().await.map_err(anyhow::Error::from) }
    )?;
    if !status.success() {
        bail!("Git exited with {status}: {}", stderr.trim());
    }
    Ok((stdout, truncated))
}

pub(crate) async fn run(command: &str, prompt: &str, cwd: &Path) -> Result<String> {
    if command.trim().is_empty() {
        bail!("Configure an AI Commit command first");
    }
    let mut child = tokio::process::Command::new("/bin/sh")
        .args(["-c", command])
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0)
        .kill_on_drop(true)
        .spawn()
        .context("Start AI Commit command")?;
    let _group = ProcessGroup(child.id().context("AI Commit process has no id")?);
    let mut stdin = child.stdin.take().context("AI Commit stdin unavailable")?;
    let stdout = child
        .stdout
        .take()
        .context("AI Commit stdout unavailable")?;
    let stderr = child
        .stderr
        .take()
        .context("AI Commit stderr unavailable")?;
    let write = async {
        // An early exit is reported using status/stderr below.
        let result = stdin.write_all(prompt.as_bytes()).await;
        drop(stdin);
        if let Err(error) = result {
            if error.kind() != std::io::ErrorKind::BrokenPipe {
                return Err(error.into());
            }
        }
        Ok::<_, anyhow::Error>(())
    };
    let (_, (stdout, truncated), (stderr, _), status) = tokio::try_join!(
        write,
        collect(stdout, 32 * 1024),
        collect(stderr, 4096),
        async { child.wait().await.map_err(anyhow::Error::from) }
    )?;
    if !status.success() {
        bail!("Command exited with {status}: {}", stderr.trim());
    }
    if truncated {
        bail!("Command output exceeds 32 KiB; output only the commit message");
    }
    clean_message(&stdout)
}

pub(super) fn clean_message(output: &str) -> Result<String> {
    let output = output.trim();
    // OpenCode's stable machine-readable mode emits text parts among events.
    // This is output decoding, not Agent selection; custom commands can use it too.
    let events: Option<Vec<serde_json::Value>> = output
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| serde_json::from_str(line).ok())
        .collect();
    let text = if let Some(events) = events.filter(|events| !events.is_empty()) {
        if let Some(error) = events.iter().find(|event| event["type"] == "error") {
            bail!("Agent returned an error: {error}");
        }
        events
            .iter()
            .filter(|event| event["type"] == "text")
            .filter_map(|event| event["part"]["text"].as_str())
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        output.to_owned()
    };
    let text = text.trim();
    let text = if text.starts_with("```") && text.ends_with("```") {
        text.split_once('\n')
            .map(|(_, rest)| rest[..rest.len().saturating_sub(3)].trim())
            .unwrap_or(text)
    } else {
        text
    };
    if text.is_empty()
        || text.contains('\0')
        || text
            .lines()
            .any(|line| line.trim_start().starts_with("Treefold-Squash:"))
    {
        bail!("Command did not return a valid commit message");
    }
    Ok(text.into())
}
