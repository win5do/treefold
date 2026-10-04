//! Native callbacks write only Treefold-owned receipts. Never discover IDs from Agent history.
use super::{AgentMetadata, LaunchContext, MetadataContext, metadata::write_private};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    io::Read,
    path::{Path, PathBuf},
};

#[derive(Serialize, Deserialize)]
struct Launch {
    token: String,
    kind: String,
    session_id: String,
    expected_id: Option<String>,
}

pub(super) fn integration_dir(directory: &Path) -> PathBuf {
    // runtime_dir is <home>/data/agent-sessions/<kind>/<id>. Keep the extension
    // path stable across Sessions so native review is not tied to a launch UUID.
    directory.parent().unwrap_or(directory).join("_integration")
}

pub(super) fn codex_override(event: &str) -> String {
    format!(
        "hooks.{event}=[{{hooks=[{{type=\"command\",command='\"$TREEFOLD_AGENT_HOOK\" --agent-hook codex',timeout=3}}]}}]"
    )
}

fn stable_file(path: &Path, bytes: &[u8]) -> Result<()> {
    if std::fs::read(path).ok().as_deref() != Some(bytes) {
        write_private(path, bytes)?;
    }
    Ok(())
}

pub(super) fn prepare(kind: &str, context: &LaunchContext<'_>) -> Result<BTreeMap<String, String>> {
    let directory = context
        .runtime_dir
        .context("Agent requires a managed runtime directory")?;
    let integration = integration_dir(directory);
    match kind {
        "claude_code" => {
            stable_file(&integration.join("claude/.claude-plugin/plugin.json"), br#"{"name":"treefold-session","version":"1.0.0","description":"Report the native Session ID to Treefold"}"#)?;
            let hook = serde_json::json!([{"hooks":[{"type":"command","command":"\"$TREEFOLD_AGENT_HOOK\" --agent-hook claude_code","timeout":3}]}]);
            let config = serde_json::json!({"hooks":{"SessionStart":hook,"UserPromptSubmit":hook}});
            stable_file(
                &integration.join("claude/hooks/hooks.json"),
                &serde_json::to_vec(&config)?,
            )?;
        }
        "pi" => stable_file(
            &integration.join("pi.mjs"),
            include_bytes!("extensions/pi.mjs"),
        )?,
        "opencode" => {
            stable_file(
                &integration.join("opencode/package.json"),
                br#"{"name":"treefold-session","private":true,"type":"module"}"#,
            )?;
            stable_file(
                &integration.join("opencode/tui.js"),
                include_bytes!("extensions/opencode.mjs"),
            )?;
        }
        _ => {}
    }
    let launch = Launch {
        token: crate::ids::new_id(),
        kind: kind.into(),
        session_id: context.session_id.into(),
        expected_id: context.resume_id.map(str::to_owned),
    };
    write_private(
        &directory.join("launch.json"),
        &serde_json::to_vec(&launch)?,
    )?;
    Ok(BTreeMap::from([
        (
            "TREEFOLD_AGENT_HOOK".into(),
            std::env::current_exe()?.to_string_lossy().into_owned(),
        ),
        (
            "TREEFOLD_AGENT_RUNTIME_DIR".into(),
            directory.to_string_lossy().into_owned(),
        ),
        ("TREEFOLD_AGENT_LAUNCH_ID".into(), launch.token),
        ("TREEFOLD_AGENT_KIND".into(), kind.into()),
    ]))
}

pub fn run() -> Result<()> {
    let kind = std::env::args().nth(2).context("missing Agent kind")?;
    let directory = PathBuf::from(std::env::var("TREEFOLD_AGENT_RUNTIME_DIR")?);
    let token = std::env::var("TREEFOLD_AGENT_LAUNCH_ID")?;
    let mut input = Vec::new();
    std::io::stdin()
        .take(64 * 1024 + 1)
        .read_to_end(&mut input)?;
    anyhow::ensure!(input.len() <= 64 * 1024, "callback is too large");
    receive(&directory, &token, &kind, &input)
}

fn receive(directory: &Path, token: &str, kind: &str, input: &[u8]) -> Result<()> {
    let launch: Launch = serde_json::from_slice(&std::fs::read(directory.join("launch.json"))?)?;
    anyhow::ensure!(
        launch.token == token && launch.kind == kind,
        "stale callback"
    );
    let value: serde_json::Value = serde_json::from_slice(input)?;
    let id = value["session_id"].as_str().context("missing session_id")?;
    anyhow::ensure!(
        !id.is_empty()
            && id.len() <= 128
            && id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"_-".contains(&c)),
        "invalid session_id"
    );
    anyhow::ensure!(
        launch
            .expected_id
            .as_deref()
            .is_none_or(|expected| expected == id),
        "callback belongs to another Session"
    );
    // First root identity wins. Native /new and /fork must not retarget the saved Resume action.
    let path = directory.join(format!("identity-{token}.json"));
    use fs2::FileExt;
    let lock = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(directory.join("identity.lock"))?;
    lock.lock_exclusive()?;
    if !path.exists() {
        write_private(
            &path,
            &serde_json::to_vec(
                &serde_json::json!({"kind":kind,"treefold_session_id":launch.session_id,"session_id":id}),
            )?,
        )?;
    }
    Ok(())
}

pub(super) fn read(kind: &str, context: &MetadataContext<'_>) -> AgentMetadata {
    let read = || -> Option<String> {
        let launch: Launch =
            serde_json::from_slice(&std::fs::read(context.runtime_dir.join("launch.json")).ok()?)
                .ok()?;
        if launch.kind != kind || launch.session_id != context.session_id {
            return None;
        }
        let value: serde_json::Value = serde_json::from_slice(
            &std::fs::read(
                context
                    .runtime_dir
                    .join(format!("identity-{}.json", launch.token)),
            )
            .ok()?,
        )
        .ok()?;
        if value["kind"] != kind || value["treefold_session_id"] != context.session_id {
            return None;
        }
        value["session_id"].as_str().map(str::to_owned)
    };
    AgentMetadata { id: read() }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn definitions_and_extension_paths_are_stable_across_launches() {
        let root = tempfile::tempdir().unwrap();
        let first = root.path().join("claude_code/one");
        let second = root.path().join("claude_code/two");
        let context = LaunchContext {
            session_id: "one",
            runtime_dir: Some(&first),
            cwd: "/repo",
            additional_directories: &[],
            initial_prompt: "",
            instructions: None,
            resume_id: None,
            log_dir: None,
        };
        let env = prepare("claude_code", &context).unwrap();
        let hook = integration_dir(&first).join("claude/hooks/hooks.json");
        let before = std::fs::metadata(&hook).unwrap().modified().unwrap();
        let next = prepare(
            "claude_code",
            &LaunchContext {
                session_id: "two",
                runtime_dir: Some(&second),
                ..context
            },
        )
        .unwrap();
        assert_eq!(integration_dir(&first), integration_dir(&second));
        assert_eq!(
            std::fs::metadata(&hook).unwrap().modified().unwrap(),
            before
        );
        assert_ne!(
            env["TREEFOLD_AGENT_LAUNCH_ID"],
            next["TREEFOLD_AGENT_LAUNCH_ID"]
        );
        let text = std::fs::read_to_string(hook).unwrap();
        assert!(!text.contains(&env["TREEFOLD_AGENT_LAUNCH_ID"]));
        let config = codex_override("SessionStart")
            .parse::<toml_edit::DocumentMut>()
            .unwrap();
        assert!(config.contains_key("hooks"));
    }
    #[test]
    fn resumed_identity_must_match_and_old_launch_cannot_authorize_new_launch() {
        let dir = tempfile::tempdir().unwrap();
        let context = LaunchContext {
            session_id: "managed",
            runtime_dir: Some(dir.path()),
            cwd: "/repo",
            additional_directories: &[],
            initial_prompt: "",
            instructions: None,
            resume_id: Some("saved"),
            log_dir: None,
        };
        let env = prepare("codex", &context).unwrap();
        let token = &env["TREEFOLD_AGENT_LAUNCH_ID"];
        assert!(receive(dir.path(), token, "codex", br#"{"session_id":"other"}"#).is_err());
        receive(dir.path(), token, "codex", br#"{"session_id":"saved"}"#).unwrap();
        prepare("codex", &context).unwrap();
        assert!(receive(dir.path(), token, "codex", br#"{"session_id":"saved"}"#).is_err());
        assert!(
            read(
                "codex",
                &MetadataContext {
                    session_id: "managed",
                    native_id: Some("saved"),
                    runtime_dir: dir.path()
                }
            )
            .id
            .is_none()
        );
    }
    #[test]
    fn accepts_only_current_callback_and_retains_first_root() {
        let dir = tempfile::tempdir().unwrap();
        let launch = Launch {
            token: "one".into(),
            kind: "codex".into(),
            session_id: "managed".into(),
            expected_id: None,
        };
        write_private(
            &dir.path().join("launch.json"),
            &serde_json::to_vec(&launch).unwrap(),
        )
        .unwrap();
        let context = MetadataContext {
            session_id: "managed",
            native_id: None,
            runtime_dir: dir.path(),
        };
        assert!(read("codex", &context).id.is_none());
        assert!(receive(dir.path(), "old", "codex", br#"{"session_id":"wrong"}"#).is_err());
        assert!(receive(dir.path(), "one", "pi", br#"{"session_id":"wrong"}"#).is_err());
        receive(dir.path(), "one", "codex", br#"{"session_id":"first"}"#).unwrap();
        receive(dir.path(), "one", "codex", br#"{"session_id":"second"}"#).unwrap();
        assert_eq!(read("codex", &context).id.as_deref(), Some("first"));
        assert!(read("pi", &context).id.is_none());
    }
}
