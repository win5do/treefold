mod metadata;
use super::{
    AgentAdapter, LaunchContext,
    validation::{
        Arity::{Flag, OptionalInline, Value, Values},
        Rules,
    },
};
use anyhow::Result;

pub(super) struct ClaudeCode;
// https://code.claude.com/docs/en/cli-reference
const RULES: Rules = Rules {
    name: "Claude Code",
    options: &[
        ("--model", Value),
        ("--fallback-model", Value),
        ("--effort", Value),
        ("--permission-mode", Value),
        ("--agent", Value),
        ("--agents", Value),
        ("--settings", Value),
        ("--setting-sources", Value),
        ("--system-prompt", Value),
        ("--system-prompt-file", Value),
        ("--name", Value),
        ("-n", Value),
        ("--debug-file", Value),
        ("--tools", Values),
        ("--allowedTools", Values),
        ("--allowed-tools", Values),
        ("--disallowedTools", Values),
        ("--disallowed-tools", Values),
        ("--mcp-config", Values),
        ("--plugin-dir", Value),
        ("--plugin-url", Value),
        ("--betas", Values),
        ("--advisor", Value),
        ("--autocompact", Value),
        ("--dangerously-skip-permissions", Flag),
        ("--allow-dangerously-skip-permissions", Flag),
        ("--strict-mcp-config", Flag),
        ("--verbose", Flag),
        ("--debug", OptionalInline),
        ("--chrome", Flag),
        ("--no-chrome", Flag),
        ("--disable-slash-commands", Flag),
        ("--safe-mode", Flag),
        ("--ax-screen-reader", Flag),
    ],
    reserved: &[
        "--cwd",
        "--session-id",
        "--resume",
        "-r",
        "--continue",
        "-c",
        "--fork-session",
        "--print",
        "-p",
        "--add-dir",
        "--append-system-prompt",
        "--append-system-prompt-file",
        "--worktree",
        "-w",
        "--tmux",
        "--background",
        "--bg",
        "--cloud",
        "--remote",
        "--teleport",
        "--desktop",
        "--output-format",
        "--input-format",
        "--no-session-persistence",
        "--help",
        "-h",
        "--version",
        "-v",
    ],
    attached_values: true,
};
impl AgentAdapter for ClaudeCode {
    fn metadata(&self, context: &super::MetadataContext<'_>) -> super::AgentMetadata {
        metadata::read(context)
    }

    fn name(&self) -> &'static str {
        "Claude Code"
    }
    fn executable(&self) -> &'static str {
        "claude"
    }
    fn validate_user_args(&self, args: &[String]) -> Result<()> {
        RULES.validate(args)
    }
    fn build_args(&self, context: &LaunchContext<'_>, user_args: &[String]) -> Result<Vec<String>> {
        let mut args = user_args.to_vec();
        if let Some(id) = context.resume_id {
            args.extend(["--resume".into(), id.into()]);
        } else {
            let id = uuid::Uuid::parse_str(context.session_id)?;
            args.extend(["--session-id".into(), id.hyphenated().to_string()]);
        }

        for directory in context.additional_directories {
            args.extend(["--add-dir".into(), directory.clone()]);
        }
        if let Some(instructions) = context.instructions {
            args.extend(["--append-system-prompt".into(), instructions.into()]);
        }
        if context.resume_id.is_none() && !context.initial_prompt.is_empty() {
            args.extend(["--".into(), context.initial_prompt.into()]);
        }
        Ok(args)
    }
}
