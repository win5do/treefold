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

pub const SETTINGS_SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct AgentsSettings {
    #[serde(default)]
    pub codex: CodexAgentSettings,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct CodexAgentSettings {
    #[serde(default)]
    pub extra_args: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct AmuxSettings {
    #[serde(default)]
    pub keep_daemon_running_on_exit: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Settings {
    pub schema_version: u32,
    pub language: String,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default)]
    pub agents: AgentsSettings,
    #[serde(default)]
    pub amux: AmuxSettings,
}

impl Settings {
    fn defaults() -> Self {
        Self {
            schema_version: SETTINGS_SCHEMA_VERSION,
            language: "system".into(),
            theme: default_theme(),
            agents: AgentsSettings {
                codex: CodexAgentSettings { extra_args: vec![] },
            },
            amux: AmuxSettings::default(),
        }
    }

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
        validate_extra_args(&self.agents.codex.extra_args)?;
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
    pub codex: Option<CodexAgentSettingsPatch>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CodexAgentSettingsPatch {
    pub extra_args: Option<Vec<String>>,
}

impl SettingsPatch {
    pub fn validate(&self) -> anyhow::Result<()> {
        if let Some(language) = &self.language {
            validate_language(language)?;
        }
        if let Some(theme) = &self.theme {
            validate_theme(theme)?;
        }
        if let Some(extra_args) = self
            .agents
            .as_ref()
            .and_then(|agents| agents.codex.as_ref())
            .and_then(|codex| codex.extra_args.as_ref())
        {
            validate_extra_args(extra_args)?;
        }
        Ok(())
    }
}

fn validate_language(language: &str) -> anyhow::Result<()> {
    if !["system", "zh-CN", "en-US"].contains(&language) {
        bail!("unsupported language '{language}'; expected system, zh-CN, or en-US");
    }
    Ok(())
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

fn validate_extra_args(extra_args: &[String]) -> anyhow::Result<()> {
    for (index, argument) in extra_args.iter().enumerate() {
        if argument.is_empty() {
            bail!("agents.codex.extra_args[{index}] must not be empty");
        }
        if argument.contains('\0') {
            bail!("agents.codex.extra_args[{index}] must not contain NUL");
        }
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
            let settings = Settings::defaults();
            store.write_new(&settings)?;
        }
        store.load()?;
        Ok(store)
    }

    pub fn load(&self) -> anyhow::Result<Settings> {
        let contents = fs::read_to_string(&self.path)
            .with_context(|| format!("read Treefold settings from {}", self.path.display()))?;
        self.parse(&contents)
    }

    pub fn treefold_home(&self) -> PathBuf {
        fs::canonicalize(&self.treefold_home).unwrap_or_else(|_| self.treefold_home.clone())
    }

    pub fn update(&self, patch: SettingsPatch) -> anyhow::Result<Settings> {
        patch.validate()?;
        let _guard = self.write_lock.lock();
        let contents = fs::read_to_string(&self.path)
            .with_context(|| format!("read Treefold settings from {}", self.path.display()))?;
        let mut document = contents
            .parse::<DocumentMut>()
            .with_context(|| format!("parse Treefold settings from {}", self.path.display()))?;
        let mut settings = self.parse(&contents)?;

        if let Some(language) = patch.language {
            settings.language = language;
            document["language"] = value(settings.language.clone());
        }
        if let Some(theme) = patch.theme {
            settings.theme = theme;
            document["theme"] = value(settings.theme.clone());
        }
        if let Some(extra_args) = patch
            .agents
            .and_then(|agents| agents.codex)
            .and_then(|codex| codex.extra_args)
        {
            settings.agents.codex.extra_args = extra_args;
            set_codex_extra_args(&mut document, &settings.agents.codex.extra_args)?;
        }
        if let Some(keep_running) = patch.amux.and_then(|amux| amux.keep_daemon_running_on_exit) {
            settings.amux.keep_daemon_running_on_exit = keep_running;
            set_amux_settings(&mut document, keep_running)?;
        }
        settings.validate()?;
        self.atomic_write(&document.to_string())?;
        Ok(settings)
    }

    fn write_new(&self, settings: &Settings) -> anyhow::Result<()> {
        let mut document = DocumentMut::new();
        document["schema_version"] = value(i64::from(settings.schema_version));
        document["language"] = value(settings.language.clone());
        document["theme"] = value(settings.theme.clone());
        let mut agents = Table::new();
        agents.set_implicit(true);
        agents.insert("codex", Item::Table(Table::new()));
        document["agents"] = Item::Table(agents);
        set_codex_extra_args(&mut document, &settings.agents.codex.extra_args)?;
        set_amux_settings(&mut document, settings.amux.keep_daemon_running_on_exit)?;
        self.atomic_write(&document.to_string())
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

fn string_array(values: &[String]) -> Item {
    let mut array = Array::new();
    for value in values {
        array.push(value.as_str());
    }
    Item::Value(Value::Array(array))
}

fn set_codex_extra_args(document: &mut DocumentMut, values: &[String]) -> anyhow::Result<()> {
    if document.get("agents").is_none() {
        let mut agents = Table::new();
        agents.set_implicit(true);
        document["agents"] = Item::Table(agents);
    }
    let agents = document["agents"]
        .as_table_like_mut()
        .context("agents must be a table")?;
    if !agents.contains_key("codex") {
        agents.insert("codex", Item::Table(Table::new()));
    }
    let codex = agents
        .get_mut("codex")
        .and_then(Item::as_table_like_mut)
        .context("agents.codex must be a table")?;
    codex.insert("extra_args", string_array(values));
    Ok(())
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
        AgentsSettings, AgentsSettingsPatch, AmuxSettings, AmuxSettingsPatch, CodexAgentSettings,
        CodexAgentSettingsPatch, SETTINGS_SCHEMA_VERSION, SettingsPatch, SettingsStore,
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
                agents: AgentsSettings {
                    codex: CodexAgentSettings { extra_args: vec![] },
                },
                amux: AmuxSettings::default(),
            }
        );
        let settings_file = treefold_home.join("config/settings.toml");
        assert!(settings_file.is_file());
        assert!(
            std::fs::read_to_string(settings_file)
                .expect("read generated settings")
                .contains("[agents.codex]\nextra_args = []")
        );
        assert!(
            std::fs::read_to_string(treefold_home.join("config/settings.toml"))
                .expect("read generated settings")
                .contains("[amux]\nkeep_daemon_running_on_exit = false")
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
                language: Some("zh-CN".into()),
                theme: Some("dark".into()),
                agents: Some(AgentsSettingsPatch {
                    codex: Some(CodexAgentSettingsPatch {
                        extra_args: Some(vec![
                            "--dangerously-bypass-approvals-and-sandbox".into(),
                            "--search".into(),
                        ]),
                    }),
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
            updated.agents.codex.extra_args,
            ["--dangerously-bypass-approvals-and-sandbox", "--search"]
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
    fn rejects_an_unsupported_schema_version() {
        let (root, _user_home) = fixture("schema");
        let treefold_home = root.join("home");
        let config_dir = treefold_home.join("config");
        std::fs::create_dir_all(&config_dir).expect("create config directory");
        std::fs::write(
            config_dir.join("settings.toml"),
            "schema_version = 2\nlanguage = \"system\"\n",
        )
        .expect("write unsupported settings");

        let error = SettingsStore::open(&treefold_home)
            .err()
            .expect("reject unsupported schema");
        assert!(
            error
                .to_string()
                .contains("unsupported settings schema_version 2")
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
    fn rejects_empty_codex_arguments_without_rewriting_the_file() {
        let (root, _user_home) = fixture("invalid-args");
        let treefold_home = root.join("home");
        let store = SettingsStore::open(&treefold_home).expect("open settings");
        let path = treefold_home.join("config/settings.toml");
        let before = std::fs::read_to_string(&path).expect("read settings before update");

        let error = store
            .update(SettingsPatch {
                agents: Some(AgentsSettingsPatch {
                    codex: Some(CodexAgentSettingsPatch {
                        extra_args: Some(vec!["".into()]),
                    }),
                }),
                ..SettingsPatch::default()
            })
            .expect_err("reject empty argument");
        assert!(
            error
                .to_string()
                .contains("extra_args[0] must not be empty")
        );
        assert_eq!(
            std::fs::read_to_string(path).expect("read settings after update"),
            before
        );

        std::fs::remove_dir_all(root).expect("remove settings fixture");
    }
}
