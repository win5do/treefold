use crate::agents::LaunchContext;
use anyhow::{Context, Result};

pub(super) fn configuration(inherited: Option<&str>) -> Result<serde_json::Value> {
    let config: serde_json::Value = match inherited.filter(|text| !text.is_empty()) {
        Some(text) => jsonc_parser::parse_to_serde_value(
            text,
            &jsonc_parser::ParseOptions {
                allow_comments: true,
                allow_trailing_commas: true,
                allow_loose_object_property_names: false,
                allow_missing_commas: false,
                allow_single_quoted_strings: false,
                allow_hexadecimal_numbers: false,
                allow_unary_plus_numbers: false,
                allow_bare_decimal_point_numbers: false,
                allow_non_finite_numbers: false,
                allow_extended_string_escapes: false,
            },
        )
        .context("Invalid OPENCODE_CONFIG_CONTENT")?,
        None => serde_json::json!({}),
    };
    let object = config
        .as_object()
        .context("OPENCODE_CONFIG_CONTENT must be an object")?;
    for key in ["plugin", "instructions"] {
        anyhow::ensure!(
            object.get(key).is_none_or(|value| value.is_array()),
            "OpenCode {key} must be an array"
        );
    }
    Ok(config)
}

pub(super) fn prepare(
    context: &LaunchContext<'_>,
    inherited: Option<&str>,
) -> Result<std::collections::BTreeMap<String, String>> {
    let mut config = configuration(inherited)?;
    let directory = context
        .runtime_dir
        .ok_or_else(|| anyhow::anyhow!("OpenCode requires a managed runtime directory"))?;
    crate::agents::metadata::write_private(
        &directory.join("plugin.mjs"),
        include_bytes!("plugin.mjs"),
    )?;
    crate::agents::metadata::write_private(
        &directory.join("instructions.md"),
        context.instructions.unwrap_or_default().as_bytes(),
    )?;
    // Inline configuration merges with the user's configuration; preserve their inline overrides too.
    let object = config
        .as_object_mut()
        .ok_or_else(|| anyhow::anyhow!("OPENCODE_CONFIG_CONTENT must be an object"))?;
    for (key, path) in [
        ("plugin", directory.join("plugin.mjs")),
        ("instructions", directory.join("instructions.md")),
    ] {
        let values = object
            .entry(key)
            .or_insert_with(|| serde_json::json!([]))
            .as_array_mut()
            .ok_or_else(|| anyhow::anyhow!("OpenCode {key} must be an array"))?;
        // Absolute plugin paths are accepted by OpenCode's plugin loader.
        values.push(serde_json::Value::String(
            path.to_string_lossy().into_owned(),
        ));
    }
    Ok(std::collections::BTreeMap::from([
        (
            "OPENCODE_CONFIG_CONTENT".into(),
            serde_json::to_string(&config)?,
        ),
        (
            "TREEFOLD_OPENCODE_SESSION_ID".into(),
            context.resume_id.unwrap_or_default().into(),
        ),
    ]))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_native_jsonc_but_rejects_malformed_configuration() {
        let config = configuration(Some(
            r#"{
            // This configuration is valid in the native CLI.
            "model": "provider/model",
            "instructions": ["https://example.test/a//b",],
            /* preserve user plugins */ "plugin": ["user-plugin"],
        }"#,
        ))
        .unwrap();
        assert_eq!(config["instructions"][0], "https://example.test/a//b");
        assert_eq!(config["plugin"][0], "user-plugin");
        assert_eq!(configuration(Some("")).unwrap(), serde_json::json!({}));
        for invalid in [
            "{",
            "{} {}",
            "{unquoted: 1}",
            "{'single':1}",
            r#"{"a":1 "b":2}"#,
            r#"{"plugin":false}"#,
            "[]",
        ] {
            assert!(configuration(Some(invalid)).is_err(), "{invalid}");
        }
    }

    #[test]
    fn launch_resources_preserve_user_configuration_and_keep_context_separate_from_prompt() {
        let root = tempfile::tempdir().unwrap();
        let context = LaunchContext {
            session_id: "managed",
            runtime_dir: Some(root.path()),
            cwd: "/checkout",
            additional_directories: &[],
            initial_prompt: "User task",
            instructions: Some("Managed context"),
            resume_id: None,
            log_dir: None,
        };
        let env = prepare(&context, Some(r#"{"model":"provider/model","permission":"ask","plugin":["existing-plugin"],"instructions":["existing.md"]}"#)).unwrap();
        let config: serde_json::Value =
            serde_json::from_str(&env["OPENCODE_CONFIG_CONTENT"]).unwrap();
        assert_eq!(config["model"], "provider/model");
        assert_eq!(config["permission"], "ask");
        assert_eq!(config["plugin"][0], "existing-plugin");
        assert_eq!(config["instructions"][0], "existing.md");
        assert_eq!(
            std::fs::read_to_string(root.path().join("instructions.md")).unwrap(),
            "Managed context"
        );
        assert!(root.path().join("plugin.mjs").is_file());
        assert!(prepare(&context, Some(r#"{"instructions":false}"#)).is_err());
    }
}
