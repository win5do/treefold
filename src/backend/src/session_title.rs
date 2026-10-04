//! Terminal title parsing and a throttled cache, independent of Agent history formats.
use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

#[derive(Default)]
pub(crate) struct TitleCache(parking_lot::Mutex<HashMap<String, Entry>>);
struct Entry {
    title: String,
    changed: Instant,
    dirty_since: Option<Instant>,
}
impl TitleCache {
    pub fn get(&self, id: &str) -> Option<String> {
        self.0.lock().get(id).map(|entry| entry.title.clone())
    }
    pub fn update(&self, id: &str, title: String, now: Instant) -> bool {
        let mut entries = self.0.lock();
        if entries.get(id).is_some_and(|entry| entry.title == title) {
            return false;
        }
        let dirty_since = entries
            .get(id)
            .and_then(|entry| entry.dirty_since)
            .unwrap_or(now);
        entries.insert(
            id.into(),
            Entry {
                title,
                changed: now,
                dirty_since: Some(dirty_since),
            },
        );
        true
    }
    pub fn pending(&self, now: Instant, flush: bool) -> Vec<(String, String)> {
        self.0
            .lock()
            .iter()
            .filter(|(_, entry)| {
                entry.dirty_since.is_some_and(|since| {
                    flush
                        || now.duration_since(entry.changed) >= Duration::from_secs(5)
                        || now.duration_since(since) >= Duration::from_secs(30)
                })
            })
            .map(|(id, entry)| (id.clone(), entry.title.clone()))
            .collect()
    }
    pub fn saved(&self, id: &str, title: &str) {
        if let Some(entry) = self
            .0
            .lock()
            .get_mut(id)
            .filter(|entry| entry.title == title)
        {
            entry.dirty_since = None;
        }
    }
}

#[derive(Default)]
pub(crate) struct Parser {
    state: u8,
    bytes: Vec<u8>,
}
impl Parser {
    pub fn reset(&mut self) {
        self.state = 0;
        self.bytes.clear();
    }
    pub fn feed(&mut self, bytes: &[u8], kind: &str) -> Vec<String> {
        let mut titles = Vec::new();
        for &byte in bytes {
            match self.state {
                0 => {
                    if byte == 0x1b {
                        self.state = 1;
                    }
                }
                1 => match byte {
                    b']' => {
                        self.bytes.clear();
                        self.state = 2;
                    }
                    b'P' | b'_' | b'^' | b'X' => self.state = 4,
                    0x1b => {}
                    _ => self.state = 0,
                },
                2 => match byte {
                    7 => {
                        self.finish(kind, &mut titles);
                    }
                    0x1b => self.state = 3,
                    0x18 | 0x1a => self.reset(),
                    _ => {
                        if self.bytes.len() < 4096 {
                            self.bytes.push(byte);
                        } else {
                            self.state = 4;
                            self.bytes.clear();
                        }
                    }
                },
                3 => {
                    if byte == b'\\' {
                        self.finish(kind, &mut titles);
                    } else {
                        self.reset();
                    }
                }
                4 => {
                    if byte == 0x1b {
                        self.state = 5;
                    } else if byte == 7 {
                        self.reset();
                    }
                }
                5 => {
                    if byte == b'\\' {
                        self.reset();
                    } else {
                        self.state = 4;
                    }
                }
                _ => self.reset(),
            }
        }
        titles
    }
    fn finish(&mut self, kind: &str, titles: &mut Vec<String>) {
        if let Ok(value) = std::str::from_utf8(&self.bytes) {
            if let Some(value) = value
                .strip_prefix("0;")
                .or_else(|| value.strip_prefix("2;"))
            {
                if let Some(value) = normalize(value, kind) {
                    titles.push(value);
                }
            }
        }
        self.reset();
    }
}

fn normalize(value: &str, kind: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() || value.chars().any(char::is_control) {
        return None;
    }
    let value = match kind {
        "claude_code" => value
            .trim_start_matches([
                '✳', '✻', '✽', '✶', '✢', '·', '*', '⠂', '⠐', '⠠', '⢀', '⡀', '⠄',
            ])
            .trim(),
        "opencode" => value.strip_prefix("OC | ").unwrap_or(value),
        "pi" => value.strip_prefix("π - ").unwrap_or(value),
        _ => value,
    };
    if value.is_empty()
        || crate::agents::name(kind).is_some_and(|name| name.eq_ignore_ascii_case(value))
    {
        return None;
    }
    Some(value.chars().take(512).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_fragmented_utf8_bel_st_and_ignores_other_sequences() {
        let input =
            "text\x1b]2;修复登录\x07\x1b]0;Second\x1b\\\x1b]1;icon\x07\x1bP\x1b]2;hidden\x1b\\"
                .as_bytes();
        let mut parser = Parser::default();
        let mut titles = Vec::new();
        for byte in input {
            titles.extend(parser.feed(&[*byte], "codex"));
        }
        assert_eq!(titles, ["修复登录", "Second"]);
        assert!(
            parser
                .feed(b"\x1b]2;Codex\x07\x1b]2;\x07", "codex")
                .is_empty()
        );
        assert_eq!(
            parser.feed("\x1b]2;✳ Fix login\x07".as_bytes(), "claude_code"),
            ["Fix login"]
        );
    }
    #[test]
    fn persists_after_quiet_period_or_maximum_wait_and_flushes() {
        let cache = TitleCache::default();
        let start = Instant::now();
        cache.update("s", "first".into(), start);
        assert!(
            cache
                .pending(start + Duration::from_secs(4), false)
                .is_empty()
        );
        assert_eq!(
            cache.pending(start + Duration::from_secs(5), false).len(),
            1
        );
        for second in 1..=30 {
            cache.update(
                "s",
                format!("title {second}"),
                start + Duration::from_secs(second),
            );
        }
        assert_eq!(
            cache.pending(start + Duration::from_secs(30), false).len(),
            1
        );
        cache.saved("s", "old");
        assert_eq!(cache.pending(start, true).len(), 1);
        cache.saved("s", "title 30");
        assert!(cache.pending(start, true).is_empty());
    }
}
