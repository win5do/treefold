mod metadata;
mod runtime;
use super::{
    AgentAdapter, LaunchContext,
    validation::{
        Arity::{Flag, Value, Values},
        Rules,
    },
};
use anyhow::Result;

pub(super) struct OpenCode;
// https://opencode.ai/docs/cli/ (TUI and global options, not `run` options).
const RULES: Rules = Rules {
    name: "OpenCode",
    options: &[
        ("--model", Value),
        ("-m", Value),
        ("--agent", Value),
        ("--port", Value),
        ("--hostname", Value),
        ("--mdns-domain", Value),
        ("--cors", Values),
        ("--log-level", Value),
        ("--print-logs", Flag),
        ("--mdns", Flag),
        ("--auto", Flag),
    ],
    reserved: &[
        "--session",
        "-s",
        "--continue",
        "-c",
        "--fork",
        "--prompt",
        "--dir",
        "--help",
        "-h",
        "--version",
        "-v",
    ],
    attached_values: true,
};
impl AgentAdapter for OpenCode {
    fn validate_resume(&self, _context: &super::MetadataContext<'_>) -> Result<()> {
        // Reject invalid inherited configuration before replacing the existing process.
        runtime::configuration(std::env::var("OPENCODE_CONFIG_CONTENT").ok().as_deref())?;
        Ok(())
    }

    fn metadata(&self, context: &super::MetadataContext<'_>) -> super::AgentMetadata {
        metadata::read(context)
    }

    fn prepare(
        &self,
        context: &LaunchContext<'_>,
    ) -> Result<std::collections::BTreeMap<String, String>> {
        runtime::prepare(
            context,
            std::env::var("OPENCODE_CONFIG_CONTENT").ok().as_deref(),
        )
    }

    fn name(&self) -> &'static str {
        "OpenCode"
    }
    fn executable(&self) -> &'static str {
        "opencode"
    }
    fn validate_user_args(&self, args: &[String]) -> Result<()> {
        RULES.validate(args)
    }
    fn build_args(&self, context: &LaunchContext<'_>, user_args: &[String]) -> Result<Vec<String>> {
        let mut args = user_args.to_vec();
        if let Some(id) = context.resume_id {
            args.extend(["--session".into(), id.into()]);
        }

        if context.resume_id.is_none() && !context.initial_prompt.is_empty() {
            args.extend(["--prompt".into(), context.initial_prompt.into()]);
        }
        Ok(args)
    }
}
