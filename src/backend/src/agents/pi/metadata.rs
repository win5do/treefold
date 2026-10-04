//! Validate a known Resume target; this never discovers an identity.
use crate::agents::MetadataContext;
use std::io::BufRead;
pub(super) fn matches_history(context: &MetadataContext<'_>) -> bool {
    let Some(id) = context.native_id else {
        return false;
    };
    let Ok(file) = std::fs::File::open(context.runtime_dir.join("session.jsonl")) else {
        return false;
    };
    let mut line = String::new();
    use std::io::Read;
    if std::io::BufReader::new(file.take(1024 * 1024))
        .read_line(&mut line)
        .is_err()
    {
        return false;
    }
    serde_json::from_str::<serde_json::Value>(&line)
        .is_ok_and(|header| header["type"] == "session" && header["id"].as_str() == Some(id))
}
