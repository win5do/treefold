use std::{
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};

use anyhow::{Context, bail};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use toml_edit::{Array, DocumentMut, Item, Table, Value, value};
use uuid::Uuid;

pub const SETTINGS_SCHEMA_VERSION: u32 = 3;

pub const AGENT_KINDS: [&str; 4] = ["codex", "claude_code", "opencode", "pi"];

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(default)]
pub struct AgentsSettings {
    pub order: Vec<String>,
    pub codex: AgentSettings,
    pub claude_code: AgentSettings,
    pub opencode: AgentSettings,
    pub pi: AgentSettings,
}

impl Default for AgentsSettings {
    fn default() -> Self {
        Self {
            order: AGENT_KINDS.iter().map(|kind| (*kind).into()).collect(),
            codex: AgentSettings::default(),
            claude_code: AgentSettings::default(),
            opencode: AgentSettings::default(),
            pi: AgentSettings::default(),
        }
    }
}

impl AgentsSettings {
    pub fn get(&self, kind: &str) -> Option<&AgentSettings> {
        match kind {
            "codex" => Some(&self.codex),
            "claude_code" => Some(&self.claude_code),
            "opencode" => Some(&self.opencode),
            "pi" => Some(&self.pi),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(default)]
pub struct AgentSettings {
    pub command: String,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct AmuxSettings {
    #[serde(default)]
    pub keep_daemon_running_on_exit: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Settings {
    pub schema_version: u32,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default)]
    pub agents: AgentsSettings,
    #[serde(default)]
    pub amux: AmuxSettings,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema_version: SETTINGS_SCHEMA_VERSION,
            language: default_language(),
            theme: default_theme(),
            agents: AgentsSettings::default(),
            amux: AmuxSettings::default(),
        }
    }
}

impl Settings {
    fn validate(&self) -> anyhow::Result<()> {
        if self.schema_version != SETTINGS_SCHEMA_VERSION {
            bail!(
                "unsupported settings schema_version {}; this Treefold supports only {}",
                self.schema_version,
                SETTINGS_SCHEMA_VERSION
            );
        }
        validate_language(&self.language)?;
        validate_theme(&self.theme)?;
        validate_order(&self.agents.order)?;
        for kind in AGENT_KINDS {
            let config = self.agents.get(kind).unwrap();
            crate::agents::adapter(kind)
                .unwrap()
                .parse_command(&config.command)?;
        }
        Ok(())
    }
}

#[derive(Deserialize)]
struct SettingsHeader {
    schema_version: u32,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SettingsPatch {
    #[serde(default)]
    pub reset: Vec<String>,
    pub language: Option<String>,
    pub theme: Option<String>,
    pub agents: Option<AgentsSettingsPatch>,
    pub amux: Option<AmuxSettingsPatch>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AmuxSettingsPatch {
    pub keep_daemon_running_on_exit: Option<bool>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AgentsSettingsPatch {
    pub order: Option<Vec<String>>,
    pub codex: Option<AgentSettingsPatch>,
    pub claude_code: Option<AgentSettingsPatch>,
    pub opencode: Option<AgentSettingsPatch>,
    pub pi: Option<AgentSettingsPatch>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AgentSettingsPatch {
    pub command: Option<String>,
}

impl SettingsPatch {
    pub fn validate(&self) -> anyhow::Result<()> {
        for key in &self.reset {
            let agent_key = AGENT_KINDS
                .iter()
                .any(|kind| key == &format!("agents.{kind}.command"));
            if !agent_key
                && ![
                    "language",
                    "theme",
                    "agents.order",
                    "amux.keep_daemon_running_on_exit",
                ]
                .contains(&key.as_str())
            {
                bail!("unknown settings key '{key}'");
            }
        }
        if let Some(language) = &self.language {
            validate_language(language)?;
        }
        if let Some(theme) = &self.theme {
            validate_theme(theme)?;
        }
        if let Some(agents) = &self.agents {
            if let Some(order) = &agents.order {
                validate_order(order)?;
            }
            for (kind, patch) in [
                ("codex", &agents.codex),
                ("claude_code", &agents.claude_code),
                ("opencode", &agents.opencode),
                ("pi", &agents.pi),
            ] {
                if let Some(patch) = patch {
                    if let Some(command) = &patch.command {
                        crate::agents::adapter(kind)
                            .unwrap()
                            .parse_command(command)?;
                    }
                }
            }
        }
        Ok(())
    }
}

fn validate_order(order: &[String]) -> anyhow::Result<()> {
    let mut sorted: Vec<_> = order.iter().map(String::as_str).collect();
    sorted.sort_unstable();
    let mut expected = AGENT_KINDS;
    expected.sort_unstable();
    if sorted != expected {
        bail!("agents.order must contain each supported Agent exactly once");
    }
    Ok(())
}

fn validate_language(language: &str) -> anyhow::Result<()> {
    if !["system", "zh-CN", "en-US"].contains(&language) {
        bail!("unsupported language '{language}'; expected system, zh-CN, or en-US");
    }
    Ok(())
}

fn default_language() -> String {
    "system".into()
}

fn default_theme() -> String {
    "system".into()
}

fn validate_theme(theme: &str) -> anyhow::Result<()> {
    if !["system", "light", "dark"].contains(&theme) {
        bail!("unsupported theme '{theme}'; expected system, light, or dark");
    }
    Ok(())
}

#[derive(Clone)]
pub struct SettingsStore {
    path: PathBuf,
    treefold_home: PathBuf,
    write_lock: Arc<Mutex<()>>,
}

impl SettingsStore {
    pub fn open(treefold_home: &Path) -> anyhow::Result<Self> {
        let config_dir = treefold_home.join("config");
        fs::create_dir_all(&config_dir).with_context(|| {
            format!("create Treefold config directory {}", config_dir.display())
        })?;
        let store = Self {
            path: config_dir.join("settings.toml"),
            treefold_home: treefold_home.to_path_buf(),
            write_lock: Arc::new(Mutex::new(())),
        };
        if !store.path.exists() {
            store.atomic_write(&format!("schema_version = {SETTINGS_SCHEMA_VERSION}\n"))?;
        }
        store.load()?;
        Ok(store)
    }

    pub fn load(&self) -> anyhow::Result<Settings> {
        let _guard = self.write_lock.lock();
        let contents = fs::read_to_string(&self.path)
            .with_context(|| format!("read Treefold settings from {}", self.path.display()))?;
        let document = migrate_document(&contents)?;
        let migrated = document.to_string();
        let settings = self.parse(&migrated)?;
        if migrated != contents {
            self.atomic_write(&migrated)?;
        }
        Ok(settings)
    }

    pub fn treefold_home(&self) -> PathBuf {
        fs::canonicalize(&self.treefold_home).unwrap_or_else(|_| self.treefold_home.clone())
    }

    pub fn update(&self, patch: SettingsPatch) -> anyhow::Result<Settings> {
        patch.validate()?;
        let _guard = self.write_lock.lock();
        let contents = fs::read_to_string(&self.path)
            .with_context(|| format!("read Treefold settings from {}", self.path.display()))?;
        let mut document = migrate_document(&contents)?;
        self.parse(&document.to_string())?;
        for key in &patch.reset {
            remove_key(document.as_item_mut(), &key.split('.').collect::<Vec<_>>());
        }
        let mut settings = self.parse(&document.to_string())?;

        if let Some(language) = patch.language {
            settings.language = language;
            document["language"] = value(settings.language.clone());
        }
        if let Some(theme) = patch.theme {
            settings.theme = theme;
            document["theme"] = value(settings.theme.clone());
        }
        if let Some(agents) = patch.agents {
            if let Some(order) = agents.order {
                set_agent_value(&mut document, None, "order", string_array(&order))?;
            }
            for (kind, config) in [
                ("codex", agents.codex),
                ("claude_code", agents.claude_code),
                ("opencode", agents.opencode),
                ("pi", agents.pi),
            ] {
                if let Some(config) = config {
                    if let Some(command) = config.command {
                        set_agent_value(&mut document, Some(kind), "command", value(command))?;
                    }
                }
            }
        }
        if let Some(keep_running) = patch.amux.and_then(|amux| amux.keep_daemon_running_on_exit) {
            settings.amux.keep_daemon_running_on_exit = keep_running;
            set_amux_settings(&mut document, keep_running)?;
        }
        settings = self.parse(&document.to_string())?;
        self.atomic_write(&document.to_string())?;
        Ok(settings)
    }

    fn parse(&self, contents: &str) -> anyhow::Result<Settings> {
        let context = || format!("parse Treefold settings from {}", self.path.display());
        let header = toml_edit::de::from_str::<SettingsHeader>(contents).with_context(context)?;
        if header.schema_version != SETTINGS_SCHEMA_VERSION {
            bail!(
                "unsupported settings schema_version {}; this Treefold supports only {}",
                header.schema_version,
                SETTINGS_SCHEMA_VERSION
            );
        }
        let settings = toml_edit::de::from_str::<Settings>(contents).with_context(context)?;
        settings.validate()?;
        Ok(settings)
    }

    fn atomic_write(&self, contents: &str) -> anyhow::Result<()> {
        let temporary = self
            .path
            .with_extension(format!("toml.tmp-{}", Uuid::new_v4().simple()));
        fs::write(&temporary, contents).with_context(|| {
            format!("write temporary Treefold settings {}", temporary.display())
        })?;
        if let Err(error) = fs::rename(&temporary, &self.path) {
            let _ = fs::remove_file(&temporary);
            return Err(error)
                .with_context(|| format!("replace Treefold settings {}", self.path.display()));
        }
        Ok(())
    }
}

fn remove_key(item: &mut Item, path: &[&str]) {
    if let Some(table) = item.as_table_like_mut() {
        if path.len() == 1 {
            table.remove(path[0]);
        } else if let Some(child) = table.get_mut(path[0]) {
            remove_key(child, &path[1..]);
        }
    }
}

fn string_array(values: &[String]) -> Item {
    let mut array = Array::new();
    for value in values {
        array.push(value.as_str());
    }
    Item::Value(Value::Array(array))
}

fn set_agent_value(
    document: &mut DocumentMut,
    kind: Option<&str>,
    key: &str,
    item: Item,
) -> anyhow::Result<()> {
    if document.get("agents").is_none() {
        let mut agents = Table::new();
        agents.set_implicit(true);
        document["agents"] = Item::Table(agents);
    }
    let agents = document["agents"]
        .as_table_like_mut()
        .context("agents must be a table")?;
    if let Some(kind) = kind {
        if !agents.contains_key(kind) {
            agents.insert(kind, Item::Table(Table::new()));
        }
        agents
            .get_mut(kind)
            .and_then(Item::as_table_like_mut)
            .context("Agent settings must be a table")?
            .insert(key, item);
    } else {
        agents.insert(key, item);
    }
    Ok(())
}

// Sequential settings migration. Validate the complete result before writing it atomically.
fn migrate_document(contents: &str) -> anyhow::Result<DocumentMut> {
    let header: SettingsHeader = toml_edit::de::from_str(contents)?;
    if header.schema_version == 0 || header.schema_version > SETTINGS_SCHEMA_VERSION {
        bail!(
            "unsupported settings schema_version {}",
            header.schema_version
        );
    }
    let mut document = contents.parse::<DocumentMut>()?;
    if header.schema_version == 1 {
        if let Some(args) = document
            .get("agents")
            .and_then(|a| a.get("codex"))
            .and_then(|c| c.get("extra_args"))
        {
            let args = args
                .as_array()
                .context("schema 1 agents.codex.extra_args must be an array")?;
            let words = args
                .iter()
                .map(|v| v.as_str().context("Codex arguments must be strings"))
                .collect::<anyhow::Result<Vec<_>>>()?;
            let quoted = shell_words::join(words);
            set_agent_value(&mut document, Some("codex"), "extra_args", value(quoted))?;
        }
        document["schema_version"] = value(2);
    }
    if document["schema_version"].as_integer() == Some(2) {
        for kind in AGENT_KINDS {
            let Some(config) = document.get("agents").and_then(|agents| agents.get(kind)) else {
                continue;
            };
            let executable = config
                .get("executable")
                .map(|item| item.as_str().context("Agent executable must be a string"))
                .transpose()?;
            let args = config
                .get("extra_args")
                .map(|item| item.as_str().context("Agent arguments must be a string"))
                .transpose()?;
            if executable.is_none() && args.is_none() {
                continue;
            }
            // Quote legacy values to preserve argv exactly, including spaces and shell characters.
            let executable = executable
                .filter(|value| !value.is_empty())
                .unwrap_or(crate::agents::adapter(kind).unwrap().executable());
            let mut words = vec![executable.to_owned()];
            words.extend(
                shell_words::split(args.unwrap_or("")).context("Invalid legacy Agent arguments")?,
            );
            let command = if words.len() == 1
                && words[0] == crate::agents::adapter(kind).unwrap().executable()
            {
                String::new()
            } else {
                shell_words::join(words)
            };
            set_agent_value(&mut document, Some(kind), "command", value(command))?;
            for key in ["executable", "extra_args"] {
                remove_key(document.as_item_mut(), &["agents", kind, key]);
            }
        }
        document["schema_version"] = value(3);
    }
    Ok(document)
}

fn set_amux_settings(document: &mut DocumentMut, keep_running: bool) -> anyhow::Result<()> {
    if document.get("amux").is_none() {
        document["amux"] = Item::Table(Table::new());
    }
    let amux = document["amux"]
        .as_table_like_mut()
        .context("amux must be a table")?;
    amux.insert("keep_daemon_running_on_exit", value(keep_running));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        AgentSettingsPatch, AgentsSettings, AgentsSettingsPatch, AmuxSettings, AmuxSettingsPatch,
        SETTINGS_SCHEMA_VERSION, SettingsPatch, SettingsStore,
    };

    fn fixture(label: &str) -> (std::path::PathBuf, std::path::PathBuf) {
        let root = std::env::temp_dir().join(format!(
            "treefold-settings-{label}-{}",
            uuid::Uuid::new_v4()
        ));
        let user_home = root.join("user");
        std::fs::create_dir_all(&user_home).expect("create test user home");
        (root, user_home)
    }

    #[test]
    fn creates_versioned_defaults_without_a_worktree_setting() {
        let (root, user_home) = fixture("defaults");
        let treefold_home = user_home.join(".treefold");
        let store = SettingsStore::open(&treefold_home).expect("open settings");

        assert_eq!(
            store.load().expect("load settings"),
            super::Settings {
                schema_version: SETTINGS_SCHEMA_VERSION,
                language: "system".into(),
                theme: "system".into(),
                agents: AgentsSettings::default(),
                amux: AmuxSettings::default(),
            }
        );
        let settings_file = treefold_home.join("config/settings.toml");
        assert!(settings_file.is_file());
        assert_eq!(
            std::fs::read_to_string(settings_file).unwrap(),
            "schema_version = 3\n"
        );

        std::fs::remove_dir_all(root).expect("remove settings fixture");
    }

    #[test]
    fn updates_settings_without_removing_comments_or_unknown_keys() {
        let (root, _user_home) = fixture("update");
        let treefold_home = root.join("custom-treefold-home");
        let store = SettingsStore::open(&treefold_home).expect("open settings");
        let path = treefold_home.join("config/settings.toml");
        std::fs::write(
            &path,
            format!(
                "# user comment\nschema_version = 1\nlanguage = \"system\"\nfuture_setting = \"preserve-me\"\n",
            ),
        )
        .expect("customize settings");

        let updated = store
            .update(SettingsPatch {
                reset: vec![],
                language: Some("zh-CN".into()),
                theme: Some("dark".into()),
                agents: Some(AgentsSettingsPatch {
                    codex: Some(AgentSettingsPatch {
                        command: Some(
                            "codex --dangerously-bypass-approvals-and-sandbox --search".into(),
                        ),
                        ..Default::default()
                    }),
                    ..Default::default()
                }),
                amux: Some(AmuxSettingsPatch {
                    keep_daemon_running_on_exit: Some(true),
                }),
            })
            .expect("update settings");
        assert_eq!(updated.language, "zh-CN");
        assert_eq!(updated.theme, "dark");
        assert!(updated.amux.keep_daemon_running_on_exit);
        assert_eq!(
            updated.agents.codex.command,
            "codex --dangerously-bypass-approvals-and-sandbox --search"
        );
        let contents = std::fs::read_to_string(path).expect("read updated settings");
        assert!(contents.contains("# user comment"));
        assert!(contents.contains("future_setting = \"preserve-me\""));
        assert!(contents.contains("theme = \"dark\""));
        assert!(contents.contains("[agents.codex]"));
        assert!(contents.contains("--dangerously-bypass-approvals-and-sandbox"));
        assert!(contents.contains("[amux]\nkeep_daemon_running_on_exit = true"));

        std::fs::remove_dir_all(root).expect("remove settings fixture");
    }

    #[test]
    fn sparse_overrides_preserve_intent_and_restore_defaults() {
        let (root, _) = fixture("sparse");
        let store = SettingsStore::open(&root).unwrap();
        let path = root.join("config/settings.toml");
        assert_eq!(store.load().unwrap(), super::Settings::default());
        store
            .update(serde_json::from_str(r#"{"theme":"dark"}"#).unwrap())
            .unwrap();
        let document = std::fs::read_to_string(&path)
            .unwrap()
            .parse::<toml_edit::DocumentMut>()
            .unwrap();
        assert_eq!(document.len(), 2);
        assert_eq!(document["theme"].as_str(), Some("dark"));
        store
            .update(serde_json::from_str(r#"{"theme":"system"}"#).unwrap())
            .unwrap();
        assert!(
            std::fs::read_to_string(&path)
                .unwrap()
                .contains("theme = \"system\"")
        );
        store
            .update(serde_json::from_str(r#"{"reset":["theme"]}"#).unwrap())
            .unwrap();
        assert_eq!(store.load().unwrap().theme, "system");
        assert!(!std::fs::read_to_string(&path).unwrap().contains("theme"));
        std::fs::write(&path, "# keep\nschema_version = 1\n[agents.codex]\nextra_args = [\"--search\"]\nfuture = 42\n").unwrap();
        store
            .update(serde_json::from_str(r#"{"reset":["agents.codex.command"]}"#).unwrap())
            .unwrap();
        let contents = std::fs::read_to_string(&path).unwrap();
        assert!(contents.contains("# keep"));
        assert!(contents.contains("future = 42"));
        assert!(store.load().unwrap().agents.codex.command.is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_an_unsupported_schema_version() {
        let (root, _user_home) = fixture("schema");
        let treefold_home = root.join("home");
        let config_dir = treefold_home.join("config");
        std::fs::create_dir_all(&config_dir).expect("create config directory");
        std::fs::write(
            config_dir.join("settings.toml"),
            "schema_version = 99\nlanguage = \"system\"\n",
        )
        .expect("write unsupported settings");

        let error = SettingsStore::open(&treefold_home)
            .err()
            .expect("reject unsupported schema");
        assert!(
            error
                .to_string()
                .contains("unsupported settings schema_version 99")
        );

        std::fs::remove_dir_all(root).expect("remove settings fixture");
    }

    #[test]
    fn rejects_invalid_partial_updates_without_rewriting_the_file() {
        let (root, _user_home) = fixture("invalid-update");
        let treefold_home = root.join("home");
        let store = SettingsStore::open(&treefold_home).expect("open settings");
        let path = treefold_home.join("config/settings.toml");
        let before = std::fs::read_to_string(&path).expect("read settings before update");

        let error = store
            .update(SettingsPatch {
                language: Some("unsupported".into()),
                ..SettingsPatch::default()
            })
            .expect_err("reject unsupported language");
        assert!(error.to_string().contains("unsupported language"));
        assert_eq!(
            std::fs::read_to_string(path).expect("read settings after update"),
            before
        );

        std::fs::remove_dir_all(root).expect("remove settings fixture");
    }

    #[test]
    fn rejects_invalid_theme_without_rewriting_the_file() {
        let (root, _user_home) = fixture("invalid-theme");
        let treefold_home = root.join("home");
        let store = SettingsStore::open(&treefold_home).expect("open settings");
        let path = treefold_home.join("config/settings.toml");
        let before = std::fs::read_to_string(&path).expect("read settings before update");

        let error = store
            .update(SettingsPatch {
                theme: Some("sepia".into()),
                ..SettingsPatch::default()
            })
            .expect_err("reject unsupported theme");
        assert!(error.to_string().contains("unsupported theme"));
        assert_eq!(
            std::fs::read_to_string(path).expect("read settings after update"),
            before
        );

        std::fs::remove_dir_all(root).expect("remove settings fixture");
    }

    #[test]
    fn rejects_unclosed_codex_arguments_without_rewriting_the_file() {
        let (root, _user_home) = fixture("invalid-args");
        let treefold_home = root.join("home");
        let store = SettingsStore::open(&treefold_home).expect("open settings");
        let path = treefold_home.join("config/settings.toml");
        let before = std::fs::read_to_string(&path).expect("read settings before update");

        let error = store
            .update(SettingsPatch {
                agents: Some(AgentsSettingsPatch {
                    codex: Some(AgentSettingsPatch {
                        command: Some("codex --model 'unfinished".into()),
                        ..Default::default()
                    }),
                    ..Default::default()
                }),
                ..SettingsPatch::default()
            })
            .expect_err("reject empty argument");
        assert!(error.to_string().contains("Invalid Agent command"));
        assert_eq!(
            std::fs::read_to_string(path).expect("read settings after update"),
            before
        );

        std::fs::remove_dir_all(root).expect("remove settings fixture");
    }
    #[test]
    fn migrates_legacy_arguments_losslessly_and_preserves_unknown_keys() {
        let dir = tempfile::tempdir().unwrap();
        let store = SettingsStore::open(dir.path()).unwrap();
        let words = vec![
            "--model",
            "a b",
            "--config",
            "value=\"quoted\"",
            "--other",
            "$HOME;$(echo x)",
            "",
        ];
        let args =
            super::string_array(&words.iter().map(|word| (*word).into()).collect::<Vec<_>>());
        let text = format!(
            "# retained\nschema_version = 1\n[agents.codex]\nfuture = 42\nextra_args = {args}\n"
        );
        std::fs::write(&store.path, text).unwrap();
        let settings = store.load().unwrap();
        assert_eq!(
            shell_words::split(&settings.agents.codex.command).unwrap(),
            std::iter::once("codex").chain(words).collect::<Vec<_>>()
        );
        let contents = std::fs::read_to_string(&store.path).unwrap();
        assert!(contents.contains("schema_version = 3"));
        assert!(contents.contains("# retained"));
        assert!(contents.contains("future = 42"));
        assert_eq!(store.load().unwrap(), settings);
    }

    #[test]
    fn migrates_schema_two_commands_and_rejects_invalid_migrations_atomically() {
        let dir = tempfile::tempdir().unwrap();
        let store = SettingsStore::open(dir.path()).unwrap();
        let input = r#"# keep
schema_version = 2
[agents.codex]
executable = "/tools with spaces/codex"
extra_args = "--model 'a b'"
future = 42
[agents.claude_code]
extra_args = "--model test"
[agents.opencode]
executable = "/tools/opencode"
[agents.pi]
executable = ""
extra_args = ""
"#;
        std::fs::write(&store.path, input).unwrap();
        let settings = store.load().unwrap();
        assert_eq!(
            crate::agents::adapter("codex")
                .unwrap()
                .parse_command(&settings.agents.codex.command)
                .unwrap(),
            (
                "/tools with spaces/codex".into(),
                vec!["--model".into(), "a b".into()]
            )
        );
        assert_eq!(settings.agents.claude_code.command, "claude --model test");
        assert_eq!(settings.agents.opencode.command, "/tools/opencode");
        assert!(settings.agents.pi.command.is_empty());
        let saved = std::fs::read_to_string(&store.path).unwrap();
        assert!(saved.contains("future = 42"));
        assert!(saved.contains("# keep"));
        assert!(!saved.contains("extra_args"));
        assert!(!saved.contains("executable"));
        assert_eq!(store.load().unwrap(), settings);
        let invalid = input.replace("--model 'a b'", "--model 'unfinished");
        std::fs::write(&store.path, &invalid).unwrap();
        assert!(store.load().is_err());
        assert_eq!(std::fs::read_to_string(&store.path).unwrap(), invalid);
    }

    #[test]
    fn agent_updates_are_partial_and_invalid_order_never_rewrites() {
        let dir = tempfile::tempdir().unwrap();
        let store = SettingsStore::open(dir.path()).unwrap();
        let updated = store.update(serde_json::from_str(r#"{"agents":{"order":["pi","opencode","codex","claude_code"],"pi":{"command":"/tmp/pi --model 'a b'"}}}"#).unwrap()).unwrap();
        assert_eq!(updated.agents.order[0], "pi");
        let next = store
            .update(
                serde_json::from_str(r#"{"agents":{"pi":{"command":"/tmp/pi --thinking high"}}}"#)
                    .unwrap(),
            )
            .unwrap();
        assert_eq!(next.agents.pi.command, "/tmp/pi --thinking high");
        assert_eq!(next.agents.codex, updated.agents.codex);
        let before = std::fs::read_to_string(&store.path).unwrap();
        for patch in [
            r#"{"agents":{"order":["pi","pi","codex","claude_code"]}}"#,
            r#"{"agents":{"order":["pi"]}}"#,
            r#"{"agents":{"claude_code":{"command":"claude --resume=wrong"}}}"#,
        ] {
            assert!(store.update(serde_json::from_str(patch).unwrap()).is_err());
            assert_eq!(std::fs::read_to_string(&store.path).unwrap(), before);
        }
    }
}
