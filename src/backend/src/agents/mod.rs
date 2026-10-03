//! CLI adapters. Only the functions in this module expose parsing and launching;
//! concrete adapters cannot override the shared validation pipeline.
mod claude_code;
mod codex;
mod command;
mod metadata;
pub use metadata::{AgentMetadata, MetadataContext, runtime_dir};
mod opencode;
mod pi;
#[cfg(test)]
mod tests;
mod validation;

use crate::settings::{AgentSettings, AgentsSettings};
use anyhow::{Context, Result};
use serde::Serialize;
use std::path::{Path, PathBuf};

/// Launch inputs, independent of database records and process ownership.
pub struct LaunchContext<'a> {
    pub session_id: &'a str,
    pub runtime_dir: Option<&'a Path>,
    pub cwd: &'a str,
    pub additional_directories: &'a [String],
    pub initial_prompt: &'a str,
    pub instructions: Option<&'a str>,
    pub resume_id: Option<&'a str>,
    pub log_dir: Option<&'a Path>,
}

trait AgentAdapter: Sync {
    fn metadata_batch(&self, contexts: &[MetadataContext<'_>]) -> Vec<AgentMetadata> {
        contexts
            .iter()
            .map(|context| self.metadata(context))
            .collect()
    }
    fn metadata(&self, context: &MetadataContext<'_>) -> AgentMetadata;
    fn prepare(
        &self,
        _context: &LaunchContext<'_>,
    ) -> Result<std::collections::BTreeMap<String, String>> {
        Ok(Default::default())
    }
    fn validate_resume(&self, _context: &MetadataContext<'_>) -> Result<()> {
        Ok(())
    }
    fn identity_pending_code(&self) -> &'static str {
        "AGENT_SESSION_ID_PENDING"
    }

    fn default_session_name(&self) -> &'static str {
        self.name()
    }
    fn name(&self) -> &'static str;
    fn executable(&self) -> &'static str;
    fn validate_user_args(&self, args: &[String]) -> Result<()>;
    fn build_args(&self, context: &LaunchContext<'_>, user_args: &[String]) -> Result<Vec<String>>;
}

fn adapter(kind: &str) -> Option<&'static dyn AgentAdapter> {
    match kind {
        "codex" => Some(&codex::Codex),
        "claude_code" => Some(&claude_code::ClaudeCode),
        "opencode" => Some(&opencode::OpenCode),
        "pi" => Some(&pi::Pi),
        _ => None,
    }
}

pub fn name(kind: &str) -> Option<&'static str> {
    adapter(kind).map(|adapter| adapter.name())
}

pub fn default_executable(kind: &str) -> Option<&'static str> {
    adapter(kind).map(|adapter| adapter.executable())
}

/// Used for settings writes, file reads, detection, and immediately before launch.
pub fn parse_command(kind: &str, text: &str) -> Result<(String, Vec<String>)> {
    let adapter = adapter(kind).with_context(|| format!("Unsupported Agent: {kind}"))?;
    let (executable, args) = command::parse(if text.trim().is_empty() {
        adapter.executable()
    } else {
        text
    })
    .map_err(|error| anyhow::anyhow!("{}: {error}", adapter.name()))?;
    adapter.validate_user_args(&args)?;
    Ok((executable, args))
}

pub fn detect_installation(kind: &str, config: &AgentSettings) -> Option<PathBuf> {
    let (executable, _) = parse_command(kind, &config.command).ok()?;
    resolve_executable(&executable)
}

pub fn build_launch(
    kind: &str,
    context: &LaunchContext<'_>,
    config: &AgentSettings,
) -> Result<Vec<String>> {
    // Validate before checking the executable so configuration errors remain precise.
    let (executable, args) = parse_command(kind, &config.command)?;
    let adapter = adapter(kind).expect("validated Agent kind");
    let executable = resolve_executable(&executable)
        .with_context(|| format!("{} CLI is not installed or executable", adapter.name()))?;
    let mut command = vec![executable.to_string_lossy().into_owned()];
    command.extend(adapter.build_args(context, &args)?);
    Ok(command)
}

#[derive(Serialize)]
pub struct AgentInstallation {
    pub kind: String,
    pub name: &'static str,
    pub available: bool,
    pub executable: Option<String>,
    pub version: Option<String>,
}

pub async fn installations(settings: &AgentsSettings) -> Vec<AgentInstallation> {
    let mut installations: Vec<_> = settings
        .order
        .iter()
        .map(|kind| {
            let adapter = adapter(kind).expect("validated Agent order");
            let executable = detect_installation(kind, settings.get(kind).unwrap());
            AgentInstallation {
                kind: kind.clone(),
                name: adapter.name(),
                available: executable.is_some(),
                version: None,
                executable: executable.map(|path| path.to_string_lossy().into_owned()),
            }
        })
        .collect();
    let mut probes = tokio::task::JoinSet::new();
    for (index, agent) in installations.iter().enumerate() {
        if let Some(executable) = agent.executable.clone() {
            probes.spawn(async move { (index, probe_version(&executable).await) });
        }
    }
    while let Some(result) = probes.join_next().await {
        if let Ok((index, version)) = result {
            installations[index].version = version;
        }
    }
    installations
}

async fn probe_version(executable: &str) -> Option<String> {
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        tokio::process::Command::new(executable)
            .arg("--version")
            .stdin(std::process::Stdio::null())
            .kill_on_drop(true)
            .output(),
    )
    .await
    .ok()?
    .ok()?;
    if !output.status.success() {
        return None;
    }
    [&output.stdout, &output.stderr]
        .into_iter()
        .find_map(|bytes| {
            String::from_utf8_lossy(bytes)
                .lines()
                .map(str::trim)
                .find(|line| !line.is_empty())
                .map(str::to_owned)
        })
}

fn resolve_executable(value: &str) -> Option<PathBuf> {
    let candidates = if value.contains('/') {
        vec![PathBuf::from(value)]
    } else {
        std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
            .map(|directory| directory.join(value))
            .collect()
    };
    candidates
        .into_iter()
        .find(|path| {
            use std::os::unix::fs::PermissionsExt;
            path.is_file()
                && path
                    .metadata()
                    .is_ok_and(|meta| meta.permissions().mode() & 0o111 != 0)
        })
        .and_then(|path| std::path::absolute(path).ok())
}

pub fn read_metadata(kind: &str, context: &MetadataContext<'_>) -> AgentMetadata {
    adapter(kind)
        .map(|agent| agent.metadata(context))
        .unwrap_or_default()
}
pub fn identity_pending_code(kind: &str) -> &'static str {
    adapter(kind)
        .map(|agent| agent.identity_pending_code())
        .unwrap_or("AGENT_SESSION_ID_PENDING")
}
pub fn prepare_environment(
    kind: &str,
    context: &LaunchContext<'_>,
) -> Result<std::collections::BTreeMap<String, String>> {
    adapter(kind).context("Unsupported Agent")?.prepare(context)
}
pub fn select_available(settings: &AgentsSettings, requested: Option<&str>) -> Result<String> {
    if let Some(kind) = requested {
        let config = settings.get(kind).context("Unsupported Agent")?;
        anyhow::ensure!(
            detect_installation(kind, config).is_some(),
            "{} CLI is not installed or executable",
            name(kind).unwrap()
        );
        return Ok(kind.into());
    }
    settings
        .order
        .iter()
        .find(|kind| detect_installation(kind, settings.get(kind).unwrap()).is_some())
        .cloned()
        .context("No installed Agent is available")
}

pub fn read_metadata_batch(kind: &str, contexts: &[MetadataContext<'_>]) -> Vec<AgentMetadata> {
    adapter(kind)
        .map(|agent| agent.metadata_batch(contexts))
        .unwrap_or_default()
}

pub fn default_session_name(kind: &str) -> Option<&'static str> {
    adapter(kind).map(|agent| agent.default_session_name())
}

pub fn validate_resume(kind: &str, context: &MetadataContext<'_>) -> Result<()> {
    adapter(kind)
        .context("Unsupported Agent")?
        .validate_resume(context)
}
