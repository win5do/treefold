mod identity;
mod metadata;
use super::{
    AgentAdapter, LaunchContext,
    validation::{
        Arity::{Flag, Value},
        Rules,
    },
};
use anyhow::{Result, bail};

pub(super) struct Codex;
// Based on `codex --help`. Keep arity explicit when adding CLI options.
const RULES: Rules = Rules {
    name: "Codex",
    options: &[
        ("--model", Value),
        ("-m", Value),
        ("--config", Value),
        ("-c", Value),
        ("--enable", Value),
        ("--disable", Value),
        ("--profile", Value),
        ("-p", Value),
        ("--sandbox", Value),
        ("-s", Value),
        ("--ask-for-approval", Value),
        ("-a", Value),
        ("--local-provider", Value),
        ("--oss", Flag),
        ("--search", Flag),
        ("--full-auto", Flag),
        ("--approve-for-me", Flag),
        ("--dangerously-bypass-approvals-and-sandbox", Flag),
        ("--yolo", Flag),
        ("--dangerously-bypass-hook-trust", Flag),
        ("--no-alt-screen", Flag),
        ("--strict-config", Flag),
        ("--no-daemon", Flag),
    ],
    reserved: &[
        "-C",
        "--cd",
        "--add-dir",
        "--worktree",
        "--remote",
        "--remote-auth-token-env",
        "--image",
        "-i",
        "--help",
        "-h",
        "--version",
        "-V",
    ],
    attached_values: true,
};

impl AgentAdapter for Codex {
    fn default_session_name(&self) -> &'static str {
        "codex"
    }
    fn metadata(&self, context: &super::MetadataContext<'_>) -> super::AgentMetadata {
        self.metadata_batch(std::slice::from_ref(context)).remove(0)
    }
    fn metadata_batch(&self, contexts: &[super::MetadataContext<'_>]) -> Vec<super::AgentMetadata> {
        let titles = if contexts.iter().any(|context| context.read_title) {
            metadata::load_titles()
        } else {
            Default::default()
        };
        let mut ids: Vec<_> = contexts
            .iter()
            .map(|context| {
                context
                    .native_id
                    .map(str::to_owned)
                    .or_else(|| metadata::launch_identity(context.argv, context.session_id))
            })
            .collect();
        let pending: Vec<_> = contexts
            .iter()
            .zip(&ids)
            .filter(|(_, id)| id.is_none())
            .map(|(context, _)| (context.session_id.into(), context.original_cwd.into()))
            .collect();
        if !pending.is_empty() {
            if let Some(home) = metadata::home() {
                let mut found = identity::scan(&home, &pending);
                for (context, id) in contexts.iter().zip(&mut ids) {
                    if id.is_none() {
                        *id = found.remove(context.session_id);
                    }
                }
            }
        }
        contexts
            .iter()
            .zip(ids)
            .map(|(context, id)| {
                let title = if context.read_title {
                    id.as_ref().and_then(|id| titles.get(id)).cloned()
                } else {
                    None
                };
                super::AgentMetadata { id, title }
            })
            .collect()
    }
    fn identity_pending_code(&self) -> &'static str {
        "CODEX_SESSION_ID_PENDING"
    }

    fn name(&self) -> &'static str {
        "Codex"
    }
    fn executable(&self) -> &'static str {
        "codex"
    }
    fn validate_user_args(&self, args: &[String]) -> Result<()> {
        RULES.validate(args)?;
        // Config overrides use TOML keys (including quoted/dotted keys), but Codex
        // also permits non-TOML values. Parse only the key to check ownership.
        let mut index = 0;
        while index < args.len() {
            let token = &args[index];
            let value = if token == "-c" || token == "--config" {
                index += 1;
                Some(args[index].as_str())
            } else if let Some(value) = token.strip_prefix("--config=") {
                Some(value)
            } else if let Some(value) = token.strip_prefix("-c") {
                Some(value.strip_prefix('=').unwrap_or(value))
            } else {
                // Skip recognized values, even when they look like another option.
                if RULES
                    .options
                    .iter()
                    .any(|(name, arity)| *name == token && matches!(arity, Value))
                {
                    index += 1;
                }
                None
            };
            if let Some(value) = value {
                let key = value
                    .split_once('=')
                    .map(|(key, _)| key)
                    .ok_or_else(|| anyhow::anyhow!("Codex: --config requires key=value"))?;
                let document = format!("{key} = 0")
                    .parse::<toml_edit::DocumentMut>()
                    .map_err(|_| anyhow::anyhow!("Codex: invalid --config key"))?;
                if ["developer_instructions", "log_dir", "cwd"]
                    .iter()
                    .any(|key| document.contains_key(key))
                {
                    bail!("Codex: configuration key {key} is managed by Treefold");
                }
            }
            index += 1;
        }
        Ok(())
    }
    fn build_args(&self, context: &LaunchContext<'_>, user_args: &[String]) -> Result<Vec<String>> {
        let mut args = user_args.to_vec();
        args.extend(["-C".into(), context.cwd.into()]);
        for path in context.additional_directories {
            args.extend(["--add-dir".into(), path.clone()]);
        }
        if !args.iter().any(|arg| arg == "--no-alt-screen") {
            args.push("--no-alt-screen".into());
        }
        if let Some(instructions) = context.instructions {
            args.extend([
                "-c".into(),
                format!(
                    "developer_instructions={}",
                    serde_json::to_string(instructions)?
                ),
            ]);
        }
        if let Some(log_dir) = context.log_dir {
            args.extend([
                "-c".into(),
                format!(
                    "log_dir={}",
                    serde_json::to_string(&log_dir.to_string_lossy())?
                ),
            ]);
        }
        if let Some(id) = context.resume_id {
            args.extend(["resume".into(), id.into()]);
        } else if !context.initial_prompt.is_empty() {
            // A prompt such as "resume" or "--help" must stay a prompt.
            args.extend(["--".into(), context.initial_prompt.into()]);
        }
        Ok(args)
    }
}

#[cfg(test)]
mod tests;
