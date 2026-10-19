use std::collections::BTreeMap;

use anyhow::{Context, bail};
use serde::{Deserialize, Serialize};
use toml_edit::{DocumentMut, Item, Table, value};

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(default)]
pub struct ProjectSettings {
    pub review_prompt: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectSettingsPatch {
    pub review_prompt: Option<String>,
}

pub(super) fn validate(projects: &BTreeMap<String, ProjectSettingsPatch>) -> anyhow::Result<()> {
    for id in projects.keys() {
        if id.is_empty()
            || !id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"_-".contains(&c))
        {
            bail!("invalid Project settings id");
        }
    }
    Ok(())
}

pub(super) fn apply(
    document: &mut DocumentMut,
    projects: BTreeMap<String, ProjectSettingsPatch>,
) -> anyhow::Result<()> {
    for (id, patch) in projects {
        let Some(prompt) = patch.review_prompt else {
            continue;
        };
        if document.get("projects").is_none() {
            document["projects"] = Item::Table(Table::new());
        }
        let table = document["projects"]
            .as_table_like_mut()
            .context("projects must be a table")?;
        if table.get(&id).is_none() {
            table.insert(&id, Item::Table(Table::new()));
        }
        let project = table
            .get_mut(&id)
            .unwrap()
            .as_table_like_mut()
            .context("Project settings must be a table")?;
        if prompt.trim().is_empty() {
            project.remove("review_prompt");
        } else {
            project.insert("review_prompt", value(prompt));
        }
        if project.is_empty() {
            table.remove(&id);
        }
        if table.is_empty() {
            document.remove("projects");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::settings::{SettingsPatch, SettingsStore};

    #[test]
    fn project_review_prompt_preserves_other_projects_and_unknown_configuration() {
        let root = tempfile::tempdir().unwrap();
        let store = SettingsStore::open(root.path()).unwrap();
        let path = root.path().join("config/settings.toml");
        std::fs::write(&path, "schema_version = 3\n[projects.first]\nreview_prompt = 'old'\nfuture = 'keep'\n[projects.second]\nreview_prompt = 'second'\n").unwrap();
        let patch = |prompt: &str| {
            serde_json::from_value::<SettingsPatch>(serde_json::json!({
                "projects": { "first": { "review_prompt": prompt } }
            }))
            .unwrap()
        };
        let saved = store.update(patch("检查接口\n保留测试")).unwrap();
        assert_eq!(saved.projects["first"].review_prompt, "检查接口\n保留测试");
        assert_eq!(store.load().unwrap(), saved);
        let reset = store.update(patch(" ")).unwrap();
        assert_eq!(reset.projects["first"].review_prompt, "");
        assert_eq!(reset.projects["second"].review_prompt, "second");
        assert!(
            std::fs::read_to_string(&path)
                .unwrap()
                .contains("future = 'keep'")
        );
        let before = std::fs::read_to_string(&path).unwrap();
        let invalid: SettingsPatch = serde_json::from_value(
            serde_json::json!({"projects":{"bad.id":{"review_prompt":"oops"}}}),
        )
        .unwrap();
        assert!(store.update(invalid).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), before);
    }
}
