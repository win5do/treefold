//! CLI adapters. Process and PTY ownership remains with TerminalManager/amux.
pub(crate) mod codex;
mod command;

use crate::{
    model::Session,
    settings::{AgentSettings, AgentsSettings},
};
use anyhow::{Context, Result, bail};
use serde::Serialize;
use std::path::{Path, PathBuf};

pub trait AgentAdapter: Sync {
    fn kind(&self) -> &'static str;
    fn name(&self) -> &'static str;
    fn executable(&self) -> &'static str;
    fn reserved_args(&self) -> &'static [&'static str];
    fn arguments(
        &self,
        session: &Session,
        instructions: Option<&str>,
        extra: Vec<String>,
    ) -> Result<Vec<String>>;

    fn detect_installation(&self, config: &AgentSettings) -> Option<PathBuf> {
        let (executable, _) = self.parse_command(&config.command).ok()?;
        resolve_executable(&executable)
    }

    fn parse_command(&self, text: &str) -> Result<(String, Vec<String>)> {
        let (executable, args) = command::parse(if text.trim().is_empty() {
            self.executable()
        } else {
            text
        })?;
        for argument in &args {
            let flag = argument.split('=').next().unwrap_or(argument);
            if flag == "--"
                || self.reserved_args().iter().any(|reserved| {
                    flag == *reserved
                        || (reserved.len() == 2
                            && reserved.starts_with('-')
                            && argument.starts_with(reserved))
                })
            {
                bail!("{} argument {flag} is managed by Treefold", self.name());
            }
        }
        Ok((executable, args))
    }

    fn build_launch(
        &self,
        session: &Session,
        instructions: Option<&str>,
        config: &AgentSettings,
        home: Option<&Path>,
    ) -> Result<Vec<String>> {
        let executable = self
            .detect_installation(config)
            .with_context(|| format!("{} CLI is not installed or executable", self.name()))?;
        let (_, extra) = self.parse_command(&config.command)?;
        let mut command = vec![executable.to_string_lossy().into_owned()];
        let mut args = self.arguments(session, instructions, extra)?;
        if self.kind() == "codex" {
            if let Some(home) = home {
                args.extend([
                    "-c".into(),
                    format!(
                        "log_dir={}",
                        serde_json::to_string(
                            &home.join("logs/codex").join(&session.id).to_string_lossy()
                        )?
                    ),
                ]);
            }
        }
        command.extend(args);
        Ok(command)
    }
}

struct Codex;
impl AgentAdapter for Codex {
    fn kind(&self) -> &'static str {
        "codex"
    }
    fn name(&self) -> &'static str {
        "Codex"
    }
    fn executable(&self) -> &'static str {
        "codex"
    }
    fn reserved_args(&self) -> &'static [&'static str] {
        &["-C", "--cd", "--add-dir"]
    }
    fn arguments(
        &self,
        session: &Session,
        instructions: Option<&str>,
        extra: Vec<String>,
    ) -> Result<Vec<String>> {
        Ok(codex::codex_arguments(session, instructions, &extra))
    }
}

struct ClaudeCode;
impl AgentAdapter for ClaudeCode {
    fn kind(&self) -> &'static str {
        "claude_code"
    }
    fn name(&self) -> &'static str {
        "Claude Code"
    }
    fn executable(&self) -> &'static str {
        "claude"
    }
    fn reserved_args(&self) -> &'static [&'static str] {
        &[
            "--cwd",
            "--session-id",
            "--resume",
            "-r",
            "--continue",
            "-c",
            "--print",
            "-p",
            "--add-dir",
            "--append-system-prompt",
            "--append-system-prompt-file",
        ]
    }
    fn arguments(
        &self,
        session: &Session,
        instructions: Option<&str>,
        mut extra: Vec<String>,
    ) -> Result<Vec<String>> {
        for directory in &session.additional_directories {
            extra.extend(["--add-dir".into(), directory.clone()]);
        }
        if let Some(instructions) = instructions {
            extra.extend(["--append-system-prompt".into(), instructions.into()]);
        }
        if !session.initial_prompt.is_empty() {
            extra.extend(["--".into(), session.initial_prompt.clone()]);
        }
        Ok(extra)
    }
}

struct OpenCode;
impl AgentAdapter for OpenCode {
    fn kind(&self) -> &'static str {
        "opencode"
    }
    fn name(&self) -> &'static str {
        "OpenCode"
    }
    fn executable(&self) -> &'static str {
        "opencode"
    }
    fn reserved_args(&self) -> &'static [&'static str] {
        &["--session", "-s", "--continue", "-c", "--prompt", "--dir"]
    }
    fn arguments(
        &self,
        session: &Session,
        _instructions: Option<&str>,
        mut extra: Vec<String>,
    ) -> Result<Vec<String>> {
        if !session.initial_prompt.is_empty() {
            extra.extend(["--prompt".into(), session.initial_prompt.clone()]);
        }
        Ok(extra)
    }
}

struct Pi;
impl AgentAdapter for Pi {
    fn kind(&self) -> &'static str {
        "pi"
    }
    fn name(&self) -> &'static str {
        "Pi"
    }
    fn executable(&self) -> &'static str {
        "pi"
    }
    fn reserved_args(&self) -> &'static [&'static str] {
        &[
            "--session",
            "--session-dir",
            "--resume",
            "-r",
            "--continue",
            "-c",
            "--mode",
            "--print",
            "-p",
            "--append-system-prompt",
        ]
    }
    fn arguments(
        &self,
        session: &Session,
        instructions: Option<&str>,
        mut extra: Vec<String>,
    ) -> Result<Vec<String>> {
        if let Some(instructions) = instructions {
            extra.extend(["--append-system-prompt".into(), instructions.into()]);
        }
        if !session.initial_prompt.is_empty() {
            extra.extend(["--".into(), session.initial_prompt.clone()]);
        }
        Ok(extra)
    }
}

pub fn adapter(kind: &str) -> Option<&'static dyn AgentAdapter> {
    match kind {
        "codex" => Some(&Codex),
        "claude_code" => Some(&ClaudeCode),
        "opencode" => Some(&OpenCode),
        "pi" => Some(&Pi),
        _ => None,
    }
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
            let executable = adapter.detect_installation(settings.get(kind).unwrap());
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_quotes_without_shell_expansion_and_rejects_owned_flags() {
        let adapter = adapter("claude_code").unwrap();
        assert_eq!(
            adapter
                .parse_command("claude --model 'a b' --setting '$HOME;$(touch /tmp/no)' ")
                .unwrap()
                .1,
            ["--model", "a b", "--setting", "$HOME;$(touch /tmp/no)"]
        );
        assert!(adapter.parse_command("claude --model 'unfinished").is_err());
        for argument in ["--resume=other", "-rother", "--session-id other", "--print"] {
            assert!(
                adapter
                    .parse_command(&format!("claude {argument}"))
                    .is_err()
            );
        }
    }

    #[test]
    fn empty_commands_use_each_adapters_default_executable() {
        for (kind, executable) in [
            ("codex", "codex"),
            ("claude_code", "claude"),
            ("opencode", "opencode"),
            ("pi", "pi"),
        ] {
            for text in ["", "   "] {
                assert_eq!(
                    adapter(kind).unwrap().parse_command(text).unwrap(),
                    (executable.into(), vec![])
                );
            }
        }
    }

    #[tokio::test]
    async fn versions_use_the_configured_cli_and_failure_keeps_it_available() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let mut settings = AgentsSettings::default();
        for (kind, config, script) in [
            ("codex", &mut settings.codex, "printf 'codex-cli 1.2.3\\n'"),
            (
                "claude",
                &mut settings.claude_code,
                "printf '2.3.4 (Claude Code)\\n' >&2",
            ),
            ("opencode", &mut settings.opencode, "exit 1"),
            ("pi", &mut settings.pi, "exec sleep 10"),
        ] {
            let path = dir.path().join(kind);
            std::fs::write(
                &path,
                format!("#!/bin/sh\n[ \"$1\" = --version ] || exit 9\n{script}\n"),
            )
            .unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
            config.command = shell_words::quote(&path.to_string_lossy()).into_owned();
        }
        let agents = installations(&settings).await;
        assert!(agents.iter().all(|agent| agent.available));
        assert_eq!(agents[0].version.as_deref(), Some("codex-cli 1.2.3"));
        assert_eq!(agents[1].version.as_deref(), Some("2.3.4 (Claude Code)"));
        assert_eq!(agents[2].version, None);
        assert_eq!(agents[3].version, None);
    }

    #[test]
    fn installation_requires_an_executable_file() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("agent with spaces");
        let config = AgentSettings {
            command: shell_words::quote(&path.to_string_lossy()).into_owned(),
            ..Default::default()
        };
        let adapter = adapter("pi").unwrap();
        assert!(adapter.detect_installation(&config).is_none());
        std::fs::write(&path, "#!/bin/sh\nexit 0\n").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert!(adapter.detect_installation(&config).is_none());
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
        assert_eq!(adapter.detect_installation(&config).unwrap(), path);
    }
}
