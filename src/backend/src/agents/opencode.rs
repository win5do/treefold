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
        if !context.initial_prompt.is_empty() {
            args.extend(["--prompt".into(), context.initial_prompt.into()]);
        }
        Ok(args)
    }
}
