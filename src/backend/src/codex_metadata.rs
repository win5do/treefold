//! Read-only adapters for Codex-owned local metadata.
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock, RwLock},
};

static INDEX_VERSION: Mutex<Option<(PathBuf, u64, std::time::SystemTime)>> = Mutex::new(None);

static TITLES: OnceLock<RwLock<HashMap<String, String>>> = OnceLock::new();

pub fn home() -> Option<PathBuf> {
    std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|p| PathBuf::from(p).join(".codex")))
}

pub fn display_name(name: String, id: Option<&str>) -> String {
    if name != "codex" {
        return name;
    }
    id.and_then(|id| TITLES.get()?.read().ok()?.get(id).cloned())
        .unwrap_or(name)
}

pub fn refresh_titles() -> bool {
    let Some(home) = home() else {
        return false;
    };
    let path = home.join("session_index.jsonl");
    let Ok(metadata) = std::fs::metadata(&path) else {
        return false;
    };
    let Ok(modified) = metadata.modified() else {
        return false;
    };
    let Ok(mut version) = INDEX_VERSION.lock() else {
        return false;
    };
    let signature = (path.clone(), metadata.len(), modified);
    if version.as_ref() == Some(&signature) || metadata.len() > 64 * 1024 * 1024 {
        return false;
    }
    let Ok(file) = std::fs::File::open(path) else {
        return false;
    };
    let titles = read_titles(BufReader::new(file.take(64 * 1024 * 1024)));
    let Ok(mut cached) = TITLES.get_or_init(Default::default).write() else {
        return false;
    };
    *version = Some(signature);
    if *cached == titles {
        return false;
    }
    *cached = titles;
    true
}

fn read_titles(reader: impl BufRead) -> HashMap<String, String> {
    let mut entries: HashMap<String, (String, String)> = HashMap::new();
    for line in reader.lines().map_while(Result::ok) {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        let (Some(id), Some(title), Some(updated)) = (
            value["id"].as_str(),
            value["thread_name"].as_str(),
            value["updated_at"].as_str(),
        ) else {
            continue;
        };
        if title.trim().is_empty() {
            continue;
        }
        let entry = entries.entry(id.into()).or_default();
        if updated >= entry.0.as_str() {
            *entry = (updated.into(), title.trim().into());
        }
    }
    entries
        .into_iter()
        .map(|(id, (_, title))| (id, title))
        .collect()
}

/// A per-Session log is an exact launch association, unlike cwd/time matching.
pub fn launch_identity(argv: &[String], session_id: &str) -> Option<String> {
    let path = argv.iter().rev().find_map(|arg| {
        let value = arg.strip_prefix("log_dir=")?;
        serde_json::from_str::<String>(value).ok()
    })?;
    let path = Path::new(&path);
    if !path.ends_with(Path::new("logs").join("codex").join(session_id)) {
        return None;
    }
    read_launch_identity(path.join("codex-tui.log"))
}

fn read_launch_identity(path: PathBuf) -> Option<String> {
    let file = std::fs::File::open(path).ok()?;
    let mut found = None;
    for line in BufReader::new(file.take(2 * 1024 * 1024))
        .lines()
        .map_while(Result::ok)
    {
        // Only the root session creation span; ignore tool output and subagent spans.
        let Some(span) = line
            .split_once(" INFO session_loop{thread_id=")
            .map(|(_, tail)| tail)
        else {
            continue;
        };
        let Some((id, suffix)) = span.split_once('}') else {
            continue;
        };
        if suffix.trim() != ": codex_core::session: new" || uuid::Uuid::parse_str(id).is_err() {
            continue;
        }
        if found.as_deref().is_some_and(|previous| previous != id) {
            return None;
        }
        found = Some(id.to_owned());
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn titles_use_latest_valid_entry() {
        let text = "{\"id\":\"a\",\"thread_name\":\"new\",\"updated_at\":\"2026-09-11\"}\n{\"id\":\"a\",\"thread_name\":\"old\",\"updated_at\":\"2026-09-10\"}\nbroken\n";
        assert_eq!(
            read_titles(text.as_bytes()).get("a").map(String::as_str),
            Some("new")
        );
        assert_eq!(display_name("My name".into(), Some("a")), "My name");
    }
    #[test]
    fn automatic_title_fills_default_name_but_not_manual_name() {
        let id = "title-test-session";
        TITLES
            .get_or_init(Default::default)
            .write()
            .unwrap()
            .insert(id.into(), "Generated title".into());
        assert_eq!(display_name("codex".into(), Some(id)), "Generated title");
        assert_eq!(display_name("Custom name".into(), Some(id)), "Custom name");
        assert_eq!(display_name("codex".into(), None), "codex");
        TITLES.get().unwrap().write().unwrap().remove(id);
    }

    #[test]
    fn launch_log_identifies_empty_conversation_without_accepting_nested_spans() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("codex-tui.log");
        let id = "01a08fff-908b-76b2-8c1c-3826e810b018";
        std::fs::write(
            &path,
            format!("time INFO outer:session_loop{{thread_id={id}}}: codex_core::session: new\n"),
        )
        .unwrap();
        assert_eq!(read_launch_identity(path.clone()), None);
        std::fs::write(
            &path,
            format!("time INFO session_loop{{thread_id={id}}}: codex_core::session: new\npartial"),
        )
        .unwrap();
        assert_eq!(read_launch_identity(path.clone()).as_deref(), Some(id));
        use std::io::Write;
        writeln!(std::fs::OpenOptions::new().append(true).open(&path).unwrap(), "\ntime INFO session_loop{{thread_id=01a08fff-908b-76b2-8c1c-3826e810b019}}: codex_core::session: new").unwrap();
        assert_eq!(read_launch_identity(path), None);
    }
}
