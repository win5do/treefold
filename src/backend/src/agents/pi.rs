mod metadata;
mod runtime;
use super::{
    AgentAdapter, LaunchContext,
    validation::{
        Arity::{Flag, Value},
        Rules,
    },
};
use anyhow::Result;

pub(super) struct Pi;
// Pi's cli/args parser uses exact tokens, including multi-letter short options.
const RULES: Rules = Rules {
    name: "Pi",
    options: &[
        ("--provider", Value),
        ("--model", Value),
        ("--models", Value),
        ("--thinking", Value),
        ("--system-prompt", Value),
        ("--name", Value),
        ("-n", Value),
        ("--tools", Value),
        ("-t", Value),
        ("--exclude-tools", Value),
        ("-xt", Value),
        ("--extension", Value),
        ("-e", Value),
        ("--skill", Value),
        ("--prompt-template", Value),
        ("--theme", Value),
        ("--use-theme", Value),
        ("--tui-mode", Value),
        ("--no-tools", Flag),
        ("-nt", Flag),
        ("--no-builtin-tools", Flag),
        ("-nbt", Flag),
        ("--no-extensions", Flag),
        ("-ne", Flag),
        ("--no-skills", Flag),
        ("-ns", Flag),
        ("--no-prompt-templates", Flag),
        ("-np", Flag),
        ("--no-themes", Flag),
        ("--no-context-files", Flag),
        ("-nc", Flag),
        ("--verbose", Flag),
        ("--approve", Flag),
        ("-a", Flag),
        ("--no-approve", Flag),
        ("-na", Flag),
        ("--offline", Flag),
    ],
    reserved: &[
        "--session",
        "--session-id",
        "--session-dir",
        "--resume",
        "-r",
        "--continue",
        "-c",
        "--fork",
        "--no-session",
        "--mode",
        "--print",
        "-p",
        "--append-system-prompt",
        "--export",
        "--list-models",
        "--help",
        "-h",
        "--version",
        "-v",
    ],
    attached_values: false,
};
impl AgentAdapter for Pi {
    fn prepare(
        &self,
        context: &LaunchContext<'_>,
    ) -> Result<std::collections::BTreeMap<String, String>> {
        runtime::prepare(context)?;
        Ok(Default::default())
    }

    fn validate_resume(&self, context: &super::MetadataContext<'_>) -> Result<()> {
        anyhow::ensure!(
            context.native_id.is_some() && metadata::matches_history(context),
            "Pi session history is missing or its identity changed. The existing Session has been preserved."
        );
        Ok(())
    }

    fn name(&self) -> &'static str {
        "Pi"
    }
    fn executable(&self) -> &'static str {
        "pi"
    }
    fn validate_user_args(&self, args: &[String]) -> Result<()> {
        RULES.validate(args)
    }
    fn build_args(&self, context: &LaunchContext<'_>, user_args: &[String]) -> Result<Vec<String>> {
        let mut args = user_args.to_vec();
        if !args
            .iter()
            .any(|arg| arg == "--no-extensions" || arg == "-ne")
        {
            if let Some(directory) = context.runtime_dir {
                args.extend([
                    "--extension".into(),
                    super::hooks::integration_dir(directory)
                        .join("pi.mjs")
                        .to_string_lossy()
                        .into_owned(),
                ]);
            }
        }
        if let Some(directory) = context.runtime_dir {
            args.extend([
                "--session".into(),
                directory
                    .join("session.jsonl")
                    .to_string_lossy()
                    .into_owned(),
            ]);
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
