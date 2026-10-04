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
    cli_config: String,
) -> Result<std::collections::BTreeMap<String, String>> {
    let mut config = configuration(inherited)?;
    let directory = context
        .runtime_dir
        .ok_or_else(|| anyhow::anyhow!("OpenCode requires a managed runtime directory"))?;
    crate::agents::metadata::write_private(
        &directory.join("instructions.md"),
        context.instructions.unwrap_or_default().as_bytes(),
    )?;
    // Inline configuration merges with the user's configuration; preserve their inline overrides too.
    let object = config
        .as_object_mut()
        .ok_or_else(|| anyhow::anyhow!("OPENCODE_CONFIG_CONTENT must be an object"))?;
    for (key, path) in [("instructions", directory.join("instructions.md"))] {
        let values = object
            .entry(key)
            .or_insert_with(|| serde_json::json!([]))
            .as_array_mut()
            .ok_or_else(|| anyhow::anyhow!("OpenCode {key} must be an array"))?;
        // An absolute path keeps instruction resolution independent of config origin.
        values.push(serde_json::Value::String(
            path.to_string_lossy().into_owned(),
        ));
    }
    Ok(std::collections::BTreeMap::from([
        (
            "OPENCODE_CONFIG_CONTENT".into(),
            serde_json::to_string(&config)?,
        ),
        ("OPENCODE_CLI_CONFIG_CONTENT".into(), cli_config),
    ]))
}

// OpenCode 2 merges this process-local CLI overlay with cli.json. Its arrays
// replace the base array, so retain the user's plugin list and its disable rules.
pub(super) fn cli_configuration(
    directory: &std::path::Path,
    inherited: Option<&str>,
) -> Result<String> {
    let config_dir = std::env::var_os("OPENCODE_CONFIG_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| {
            std::env::var_os("XDG_CONFIG_HOME")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| {
                    std::path::PathBuf::from(std::env::var_os("HOME").unwrap_or_default())
                        .join(".config")
                })
                .join("opencode")
        });
    let mut config = configuration(inherited).context("Invalid OPENCODE_CLI_CONFIG_CONTENT")?;
    let plugins = if let Some(value) = config.get("plugins") {
        value.clone()
    } else {
        match std::fs::read_to_string(config_dir.join("cli.json")) {
            Ok(text) => configuration(Some(&text))
                .context("Invalid OpenCode cli.json")?
                .get("plugins")
                .cloned()
                .unwrap_or_else(|| serde_json::json!([])),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => serde_json::json!([]),
            Err(error) => return Err(error.into()),
        }
    };
    config["plugins"] = merge_cli_plugins(directory, &config_dir, plugins)?;
    Ok(serde_json::to_string(&config)?)
}

fn merge_cli_plugins(
    directory: &std::path::Path,
    config_dir: &std::path::Path,
    plugins: serde_json::Value,
) -> Result<serde_json::Value> {
    let mut values = vec![serde_json::Value::String(
        super::super::hooks::integration_dir(directory)
            .join("opencode")
            .to_string_lossy()
            .into_owned(),
    )];
    for mut value in plugins
        .as_array()
        .context("OpenCode CLI plugins must be an array")?
        .clone()
    {
        let spec = if value.is_object() {
            &mut value["package"]
        } else {
            &mut value
        };
        if let Some(relative) = spec
            .as_str()
            .filter(|path| path.starts_with("./") || path.starts_with("../"))
        {
            *spec = serde_json::Value::String(
                std::path::absolute(config_dir.join(relative))?
                    .to_string_lossy()
                    .into_owned(),
            );
        }
        // Rules follow the integration entry, so explicit -treefold.* remains authoritative.
        values.push(value);
    }
    Ok(serde_json::Value::Array(values))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cli_plugins_preserve_relative_packages_options_and_disable_rules() {
        let value = merge_cli_plugins(
            std::path::Path::new("/home/data/agent-sessions/opencode/id"),
            std::path::Path::new("/config"),
            serde_json::json!([{"package":"./mine", "options":{"enabled":true}}, "-treefold.*"]),
        )
        .unwrap();
        assert!(
            value[0]
                .as_str()
                .unwrap()
                .ends_with("/_integration/opencode")
        );
        assert_eq!(value[1]["package"], "/config/mine");
        assert_eq!(value[1]["options"]["enabled"], true);
        assert_eq!(value[2], "-treefold.*");
        assert!(
            merge_cli_plugins(
                std::path::Path::new("/runtime"),
                std::path::Path::new("/config"),
                serde_json::json!(false)
            )
            .is_err()
        );
    }
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
        let env = prepare(&context, Some(r#"{"model":"provider/model","permission":"ask","plugin":["existing-plugin"],"instructions":["existing.md"]}"#), r#"{"plugins":["treefold"]}"#.into()).unwrap();
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
        let cli: serde_json::Value =
            serde_json::from_str(&env["OPENCODE_CLI_CONFIG_CONTENT"]).unwrap();
        assert_eq!(cli["plugins"][0], "treefold");
        assert!(prepare(&context, Some(r#"{"instructions":false}"#), "{}".into()).is_err());
    }
}
