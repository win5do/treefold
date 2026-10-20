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

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(default)]
pub struct UpdateSettings {
    pub skipped_version: Option<String>,
    /// Unix timestamp in milliseconds; automatic notices stay quiet until then.
    pub remind_after: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Settings {
    pub schema_version: u32,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_close_behavior")]
    pub close_behavior: String,
    #[serde(default)]
    pub agents: AgentsSettings,
    #[serde(default)]
    pub amux: AmuxSettings,
    #[serde(default)]
    pub updates: UpdateSettings,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema_version: SETTINGS_SCHEMA_VERSION,
            language: default_language(),
            theme: default_theme(),
            close_behavior: default_close_behavior(),
            agents: AgentsSettings::default(),
            amux: AmuxSettings::default(),
            updates: UpdateSettings::default(),
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
        validate_close_behavior(&self.close_behavior)?;
        validate_remind_after(self.updates.remind_after)?;
        validate_order(&self.agents.order)?;
        for kind in AGENT_KINDS {
            let config = self.agents.get(kind).unwrap();
            crate::agents::parse_command(kind, &config.command)?;
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
    pub close_behavior: Option<String>,
    pub agents: Option<AgentsSettingsPatch>,
    pub amux: Option<AmuxSettingsPatch>,
    pub updates: Option<UpdateSettingsPatch>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UpdateSettingsPatch {
    pub skipped_version: Option<String>,
    pub remind_after: Option<i64>,
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
                    "close_behavior",
                    "agents.order",
                    "amux.keep_daemon_running_on_exit",
                    "updates.skipped_version",
                    "updates.remind_after",
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
        if let Some(behavior) = &self.close_behavior {
            validate_close_behavior(behavior)?;
        }
        if let Some(updates) = &self.updates {
            validate_remind_after(updates.remind_after)?;
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
                        crate::agents::parse_command(kind, command)?;
                    }
                }
            }
        }
        Ok(())
    }
}

fn validate_remind_after(timestamp: Option<i64>) -> anyhow::Result<()> {
    if timestamp.is_some_and(|value| !(0..=8_640_000_000_000_000).contains(&value)) {
        bail!("updates.remind_after must be a nonnegative Unix timestamp in milliseconds");
    }
    Ok(())
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

fn default_close_behavior() -> String {
    "hide_to_tray".into()
}

fn validate_close_behavior(behavior: &str) -> anyhow::Result<()> {
    if !["hide_to_tray", "quit"].contains(&behavior) {
        bail!("unsupported close_behavior '{behavior}'; expected hide_to_tray or quit");
    }
    Ok(())
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
        if let Some(behavior) = patch.close_behavior {
            document["close_behavior"] = value(behavior);
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
        if let Some(updates) = patch.updates {
            if document.get("updates").is_none() {
                document["updates"] = Item::Table(Table::new());
            }
            let table = document["updates"]
                .as_table_like_mut()
                .context("updates must be a table")?;
            if let Some(version) = updates.skipped_version {
                table.insert("skipped_version", value(version));
            }
            if let Some(timestamp) = updates.remind_after {
                table.insert("remind_after", value(timestamp));
            }
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
                .unwrap_or(crate::agents::default_executable(kind).unwrap());
            let mut words = vec![executable.to_owned()];
            words.extend(
                shell_words::split(args.unwrap_or("")).context("Invalid legacy Agent arguments")?,
            );
            let command = if words.len() == 1
                && words[0] == crate::agents::default_executable(kind).unwrap()
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

    #[test]
    fn update_reminders_persist_and_preserve_unrelated_settings() {
        let dir = tempfile::tempdir().unwrap();
        let store = SettingsStore::open(dir.path()).unwrap();
        std::fs::write(
            &store.path,
            "schema_version = 3\n# keep\ntheme = \"dark\"\n[updates]\nfuture = true\n",
        )
        .unwrap();
        let later = store
            .update(
                serde_json::from_value(serde_json::json!({
                    "updates": {"remind_after": 1_800_000_000_000_i64}
                }))
                .unwrap(),
            )
            .unwrap();
        assert_eq!(later.updates.remind_after, Some(1_800_000_000_000));
        assert_eq!(
            SettingsStore::open(dir.path()).unwrap().load().unwrap(),
            later
        );
        let skip = store
            .update(
                serde_json::from_value(serde_json::json!({
                    "reset": ["updates.remind_after"],
                    "updates": {"skipped_version": "1.2.3"}
                }))
                .unwrap(),
            )
            .unwrap();
        assert_eq!(skip.updates.skipped_version.as_deref(), Some("1.2.3"));
        assert_eq!(skip.updates.remind_after, None);
        let contents = std::fs::read_to_string(&store.path).unwrap();
        assert!(contents.contains("# keep"));
        assert!(contents.contains("future = true"));
        assert_eq!(skip.theme, "dark");
        let settings = store
            .update(
                serde_json::from_value(serde_json::json!({
                    "reset": ["updates.skipped_version"],
                    "updates": {"remind_after": 1_900_000_000_000_i64}
                }))
                .unwrap(),
            )
            .unwrap();
        assert_eq!(settings.updates.skipped_version, None);
        assert_eq!(settings.updates.remind_after, Some(1_900_000_000_000));
        let before = std::fs::read_to_string(&store.path).unwrap();
        for timestamp in [-1_i64, 8_640_000_000_000_001] {
            assert!(
                store
                    .update(
                        serde_json::from_value(serde_json::json!({
                            "updates": {"remind_after": timestamp}
                        }))
                        .unwrap()
                    )
                    .is_err()
            );
            assert_eq!(std::fs::read_to_string(&store.path).unwrap(), before);
        }
    }

    #[test]
    fn close_behavior_persists_resets_and_rejects_invalid_values_atomically() {
        let dir = tempfile::tempdir().unwrap();
        let store = SettingsStore::open(dir.path()).unwrap();
        assert_eq!(store.load().unwrap().close_behavior, "hide_to_tray");
        let initial = "schema_version = 3\n# keep\ntheme = \"dark\"\nfuture = true\n";
        std::fs::write(&store.path, initial).unwrap();

        for behavior in ["quit", "hide_to_tray"] {
            let settings = store
                .update(
                    serde_json::from_value(serde_json::json!({"close_behavior": behavior}))
                        .unwrap(),
                )
                .unwrap();
            assert_eq!(settings.close_behavior, behavior);
            assert_eq!(
                SettingsStore::open(dir.path()).unwrap().load().unwrap(),
                settings
            );
            let saved = std::fs::read_to_string(&store.path).unwrap();
            assert!(saved.contains(&format!("close_behavior = \"{behavior}\"")));
            assert!(saved.contains("# keep"));
            assert!(saved.contains("future = true"));
            assert_eq!(settings.theme, "dark");
        }
        let saved = std::fs::read_to_string(&store.path).unwrap();
        let invalid = serde_json::from_value(serde_json::json!({
            "theme": "light", "close_behavior": "minimize"
        }))
        .unwrap();
        assert!(store.update(invalid).is_err());
        assert_eq!(std::fs::read_to_string(&store.path).unwrap(), saved);
        let invalid_file = saved.replace("hide_to_tray", "minimize");
        std::fs::write(&store.path, &invalid_file).unwrap();
        assert!(store.load().is_err());
        assert_eq!(std::fs::read_to_string(&store.path).unwrap(), invalid_file);
        std::fs::write(&store.path, &saved).unwrap();

        let reset = store
            .update(
                serde_json::from_value(serde_json::json!({"reset": ["close_behavior"]})).unwrap(),
            )
            .unwrap();
        assert_eq!(reset.close_behavior, "hide_to_tray");
        assert_eq!(std::fs::read_to_string(&store.path).unwrap(), initial);
    }

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
                close_behavior: "hide_to_tray".into(),
                agents: AgentsSettings::default(),
                amux: AmuxSettings::default(),
                updates: super::UpdateSettings::default(),
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
                ..Default::default()
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
            "--profile",
            "$HOME;$(echo x)",
            "--model",
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
            crate::agents::parse_command("codex", &settings.agents.codex.command).unwrap(),
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
    #[test]
    fn rejects_noninteractive_agent_commands_atomically_on_save_and_load() {
        let dir = tempfile::tempdir().unwrap();
        let store = SettingsStore::open(dir.path()).unwrap();
        let before = std::fs::read_to_string(&store.path).unwrap();
        for (kind, command) in [
            ("codex", "codex resume existing"),
            ("codex", "codex --model test exec task"),
            ("claude_code", "claude update"),
            ("opencode", "opencode run task"),
            ("pi", "pi --model test 'initial prompt'"),
        ] {
            let patch =
                serde_json::from_value(serde_json::json!({"agents": {kind: {"command": command}}}))
                    .unwrap();
            let error = store.update(patch).unwrap_err();
            assert!(
                error
                    .to_string()
                    .contains(crate::agents::name(kind).unwrap())
            );
            assert_eq!(std::fs::read_to_string(&store.path).unwrap(), before);
            let mut document = before.parse::<toml_edit::DocumentMut>().unwrap();
            super::set_agent_value(
                &mut document,
                Some(kind),
                "command",
                toml_edit::value(command),
            )
            .unwrap();
            let invalid = document.to_string();
            std::fs::write(&store.path, &invalid).unwrap();
            assert!(store.load().is_err());
            assert_eq!(std::fs::read_to_string(&store.path).unwrap(), invalid);
            std::fs::write(&store.path, &before).unwrap();
        }
    }
}
