use anyhow::{Context, bail};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};
use toml_edit::{DocumentMut, Item, Table, value};

const KEYMAP_SCHEMA_VERSION: u32 = 1;

mod action_definitions;
use action_definitions::COMMANDS;
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(untagged)]
pub enum Binding {
    Shortcut(String),
    Disabled(bool),
}
#[derive(Deserialize)]
struct FileConfig {
    schema_version: u32,
    #[serde(default)]
    bindings: BTreeMap<String, Binding>,
}
#[derive(Debug, Serialize)]
pub struct Command {
    id: String,
    label: String,
    default_binding: String,
    binding: Binding,
    source: &'static str,
}
#[derive(Debug, Serialize)]
pub struct Keymap {
    schema_version: u32,
    commands: Vec<Command>,
}
#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KeymapPatch {
    #[serde(default)]
    bindings: BTreeMap<String, Option<Binding>>,
}

pub fn normalize_shortcut(input: &str) -> anyhow::Result<String> {
    let parts: Vec<_> = input
        .split('+')
        .map(|part| part.trim().to_lowercase())
        .collect();
    let mut modifiers = [false; 4];
    if parts.len() < 2 {
        bail!("shortcut requires a modifier and a key");
    }
    for part in &parts[..parts.len() - 1] {
        let index = match part.as_str() {
            "cmd" | "command" | "win" | "super" | "meta" => 0,
            "ctrl" | "control" => 1,
            "alt" | "opt" | "option" => 2,
            "shift" => 3,
            _ => bail!("unknown modifier '{part}'"),
        };
        if modifiers[index] {
            bail!("duplicate modifier '{part}'");
        }
        modifiers[index] = true;
    }
    if !modifiers[..3].iter().any(|value| *value) {
        bail!("shortcut requires super, ctrl, or alt");
    }
    let key = parts.last().unwrap();
    let valid = (key.chars().count() == 1
        && key
            .chars()
            .all(|ch| !ch.is_control() && !ch.is_whitespace()))
        || [
            "plus",
            "tab",
            "enter",
            "space",
            "backspace",
            "delete",
            "arrowup",
            "arrowdown",
            "arrowleft",
            "arrowright",
            "home",
            "end",
            "pageup",
            "pagedown",
        ]
        .contains(&key.as_str())
        || key
            .strip_prefix('f')
            .and_then(|v| v.parse::<u8>().ok())
            .is_some_and(|v| (1..=24).contains(&v));
    if !valid {
        bail!("unsupported key '{key}'");
    }
    let mut chord: Vec<_> = ["super", "ctrl", "alt", "shift"]
        .into_iter()
        .enumerate()
        .filter_map(|(i, name)| modifiers[i].then_some(name))
        .collect();
    chord.push(key);
    let chord = chord.join("+");
    if [
        "super+q",
        "super+h",
        "super+m",
        "super+space",
        "super+tab",
        "super+shift+tab",
        "ctrl+alt+delete",
        "alt+tab",
        "alt+f4",
    ]
    .contains(&chord.as_str())
    {
        bail!("'{chord}' is reserved for the operating system or application window");
    }
    Ok(chord)
}
fn parse(contents: &str) -> anyhow::Result<Keymap> {
    let file: FileConfig = toml_edit::de::from_str(contents)?;
    if file.schema_version != KEYMAP_SCHEMA_VERSION {
        bail!("unsupported keymap schema_version {}", file.schema_version);
    }
    for id in file.bindings.keys() {
        if !COMMANDS.iter().any(|command| command.0 == id) {
            bail!("unknown command '{id}'");
        }
    }
    let mut chords = BTreeMap::new();
    let mut commands = vec![];
    for &(id, label, default_binding) in COMMANDS {
        let binding = file
            .bindings
            .get(id)
            .cloned()
            .unwrap_or(Binding::Shortcut(default_binding.into()));
        let binding = match binding {
            Binding::Disabled(false) => Binding::Disabled(false),
            Binding::Disabled(true) => bail!("'{id}': use false to disable or a shortcut string"),
            Binding::Shortcut(input) => {
                let chord = normalize_shortcut(&input)?;
                if let Some(previous) = chords.insert(chord.clone(), id) {
                    bail!("shortcut '{chord}' conflicts between '{previous}' and '{id}'");
                }
                Binding::Shortcut(chord)
            }
        };
        commands.push(Command {
            id: id.into(),
            label: label.into(),
            default_binding: default_binding.into(),
            binding,
            source: if file.bindings.contains_key(id) {
                "user"
            } else {
                "default"
            },
        });
    }
    Ok(Keymap {
        schema_version: KEYMAP_SCHEMA_VERSION,
        commands,
    })
}
#[derive(Clone)]
pub struct KeymapStore {
    path: PathBuf,
    write_lock: Arc<Mutex<()>>,
}
impl KeymapStore {
    pub fn open(home: &Path) -> anyhow::Result<Self> {
        let path = home.join("config/keymap.toml");
        fs::create_dir_all(path.parent().unwrap())?;
        let store = Self {
            path,
            write_lock: Arc::new(Mutex::new(())),
        };
        if !store.path.exists() {
            store.write(&format!("schema_version = {KEYMAP_SCHEMA_VERSION}\n"))?;
        }
        store.load()?;
        Ok(store)
    }
    pub fn load(&self) -> anyhow::Result<Keymap> {
        parse(&fs::read_to_string(&self.path)?)
    }
    pub fn update(&self, patch: KeymapPatch) -> anyhow::Result<Keymap> {
        let _guard = self.write_lock.lock();
        let contents = fs::read_to_string(&self.path)?;
        parse(&contents)?;
        let mut document = contents.parse::<DocumentMut>()?;
        if document.get("bindings").is_none() {
            document["bindings"] = Item::Table(Table::new());
        }
        let bindings = document["bindings"]
            .as_table_like_mut()
            .context("bindings must be a table")?;
        for (id, binding) in patch.bindings {
            if !COMMANDS.iter().any(|command| command.0 == id) {
                bail!("unknown command '{id}'");
            }
            match binding {
                None => {
                    bindings.remove(&id);
                }
                Some(Binding::Disabled(disabled)) => {
                    bindings.insert(&id, value(disabled));
                }
                Some(Binding::Shortcut(chord)) => {
                    normalize_shortcut(&chord)?;
                    bindings.insert(&id, value(chord));
                }
            }
        }
        let next = parse(&document.to_string())?;
        self.write(&document.to_string())?;
        Ok(next)
    }
    fn write(&self, contents: &str) -> anyhow::Result<()> {
        let temporary = self
            .path
            .with_extension(format!("toml.tmp-{}", uuid::Uuid::new_v4().simple()));
        fs::write(&temporary, contents)?;
        if let Err(error) = fs::rename(&temporary, &self.path) {
            let _ = fs::remove_file(&temporary);
            return Err(error.into());
        }
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn palette_binding_is_configurable_and_participates_in_conflicts() {
        let defaults = parse("schema_version = 1\n").unwrap();
        let palette = defaults
            .commands
            .iter()
            .find(|command| command.id == "app.palette.open")
            .unwrap();
        assert_eq!(palette.binding, Binding::Shortcut("super+shift+p".into()));
        assert!(
            parse("schema_version = 1\n[bindings]\n\"session.new\" = \"cmd+shift+p\"\n").is_err()
        );
        let disabled =
            parse("schema_version = 1\n[bindings]\n\"app.palette.open\" = false\n").unwrap();
        assert_eq!(
            disabled.commands.last().unwrap().binding,
            Binding::Disabled(false)
        );
    }
    #[test]
    fn overrides_disable_reset_and_validation() {
        let home = std::env::temp_dir().join(format!("treefold-keymap-{}", uuid::Uuid::new_v4()));
        let store = KeymapStore::open(&home).unwrap();
        assert_eq!(
            fs::read_to_string(&store.path).unwrap(),
            "schema_version = 1\n"
        );
        assert_eq!(
            store.load().unwrap().commands[0].binding,
            Binding::Shortcut("super+t".into())
        );
        fs::write(
            &store.path,
            "# keep comment\nschema_version = 1\nfuture = 42\n",
        )
        .unwrap();
        let update = |json| store.update(serde_json::from_str(json).unwrap());
        let next = update(r#"{"bindings":{"session.new":"CMD+N","session.close":false}}"#).unwrap();
        assert_eq!(
            next.commands[0].binding,
            Binding::Shortcut("super+n".into())
        );
        assert_eq!(next.commands[1].binding, Binding::Disabled(false));
        assert!(fs::read_to_string(&store.path).unwrap().contains("CMD+N"));
        update(r#"{"bindings":{"session.close":"win+w"}}"#).unwrap();
        let persisted = fs::read_to_string(&store.path).unwrap();
        assert!(persisted.contains("CMD+N"));
        assert!(persisted.contains("win+w"));
        assert_eq!(normalize_shortcut("win+n").unwrap(), "super+n");
        update(r#"{"bindings":{"session.close":false}}"#).unwrap();
        let before = fs::read_to_string(&store.path).unwrap();
        for json in [
            r#"{"bindings":{"session.close":"super+n"}}"#,
            r#"{"bindings":{"session.close":true}}"#,
            r#"{"bindings":{"missing":false}}"#,
            r#"{"bindings":{"session.new":"super+q"}}"#,
        ] {
            assert!(update(json).is_err());
            assert_eq!(fs::read_to_string(&store.path).unwrap(), before);
        }
        let next = update(r#"{"bindings":{"session.new":null}}"#).unwrap();
        assert_eq!(next.commands[0].source, "default");
        assert_eq!(next.commands[1].binding, Binding::Disabled(false));
        let contents = fs::read_to_string(&store.path).unwrap();
        assert!(contents.contains("# keep comment"));
        assert!(contents.contains("future = 42"));
        assert!(!contents.contains("session.new"));
        fs::write(&store.path, "schema_version = 2\n").unwrap();
        assert!(store.load().is_err());
        assert!(update(r#"{"bindings":{}}"#).is_err());
        assert_eq!(
            fs::read_to_string(&store.path).unwrap(),
            "schema_version = 2\n"
        );
        fs::remove_dir_all(home).unwrap();
    }
}
