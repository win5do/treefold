use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::Arc,
};

use serde::{Deserialize, Serialize};

const RECEIPT_FILE: &str = "data/agent-integration.json";

#[derive(Clone)]
pub struct IntegrationManager {
    inner: Arc<Inner>,
}

struct Inner {
    treefold_home: PathBuf,
    manifest_path: PathBuf,
    bundle_root: PathBuf,
    components: Vec<ComponentSpec>,
}

#[derive(Clone)]
struct ComponentSpec {
    id: &'static str,
    version: String,
    source: PathBuf,
    install_path: Option<PathBuf>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct IntegrationManifest {
    pub schema_version: u32,
    pub bundle_version: String,
    pub protocol_version: String,
    pub components: ManifestComponents,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ManifestComponents {
    pub treefold_cli: String,
    pub amux_cli: String,
    pub treefold_skill: String,
    pub amux_skill: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IntegrationState {
    Ready,
    NotInstalled,
    Outdated,
    Partial,
    Conflict,
    Unavailable,
}

#[derive(Debug, Clone, Serialize)]
pub struct ComponentStatus {
    pub id: String,
    pub version: String,
    pub source_path: String,
    pub install_path: Option<String>,
    pub state: IntegrationState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct IntegrationStatus {
    pub state: IntegrationState,
    pub app_version: String,
    pub bundle_version: String,
    pub protocol_version: String,
    pub bundle_path: String,
    pub components: Vec<ComponentStatus>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
struct Receipt {
    schema_version: u32,
    bundle_version: String,
    links: BTreeMap<PathBuf, PathBuf>,
}

#[derive(Debug, thiserror::Error)]
pub enum IntegrationError {
    #[error("Agent integration conflicts with an existing file or unmanaged link: {0}")]
    Conflict(PathBuf),
    #[error("bundled Agent integration resource is unavailable: {0}")]
    Unavailable(PathBuf),
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

impl IntegrationManager {
    #[cfg(test)]
    pub fn test(treefold_home: &Path) -> Self {
        let manifest = IntegrationManifest {
            schema_version: 1,
            bundle_version: "test".into(),
            protocol_version: "1".into(),
            components: ManifestComponents {
                treefold_cli: "test".into(),
                amux_cli: "test".into(),
                treefold_skill: "test".into(),
                amux_skill: "test".into(),
            },
        };
        Self::from_parts(
            treefold_home,
            treefold_home.join("bundle"),
            treefold_home.join("bundle/manifest.json"),
            manifest,
            Vec::new(),
        )
    }

    pub fn new(
        treefold_home: &Path,
        user_home: &Path,
        resource_dir: &Path,
        executable_dir: &Path,
    ) -> anyhow::Result<Self> {
        let packaged_root = resource_dir.join("agent-integration");
        let development_root =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/agent-integration");
        let bundle_root = if packaged_root.join("manifest.json").is_file() {
            packaged_root
        } else {
            development_root
        };
        let manifest_path = bundle_root.join("manifest.json");
        let manifest: IntegrationManifest =
            serde_json::from_slice(&std::fs::read(&manifest_path)?)?;
        let bin_dir = std::env::var_os("TREEFOLD_BUNDLED_BIN_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| executable_dir.to_path_buf());
        let development_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("src-tauri has a parent")
            .to_path_buf();
        let skill_root = bundle_root.join("skills");
        let treefold_skill = if skill_root.join("treefold/SKILL.md").is_file() {
            skill_root.join("treefold")
        } else {
            development_root.join("cli/skills/treefold")
        };
        let amux_skill = if skill_root.join("amux/SKILL.md").is_file() {
            skill_root.join("amux")
        } else if let Some(path) = std::env::var_os("TREEFOLD_AMUX_SKILL_DIR") {
            PathBuf::from(path)
        } else {
            development_root
                .parent()
                .expect("Treefold development root has a parent")
                .join("amux/skills/amux")
        };
        Ok(Self::from_parts(
            treefold_home,
            bundle_root,
            manifest_path,
            manifest,
            vec![
                (
                    "treefold_cli",
                    bin_dir.join("treefold"),
                    Some(user_home.join(".local/bin/treefold")),
                ),
                ("amux_cli", bin_dir.join("amux"), None),
                (
                    "treefold_skill",
                    treefold_skill,
                    Some(user_home.join(".agents/skills/treefold")),
                ),
                (
                    "amux_skill",
                    amux_skill,
                    Some(user_home.join(".agents/skills/amux")),
                ),
            ],
        ))
    }

    fn from_parts(
        treefold_home: &Path,
        bundle_root: PathBuf,
        manifest_path: PathBuf,
        manifest: IntegrationManifest,
        paths: Vec<(&'static str, PathBuf, Option<PathBuf>)>,
    ) -> Self {
        let version = |id| match id {
            "treefold_cli" => manifest.components.treefold_cli.clone(),
            "amux_cli" => manifest.components.amux_cli.clone(),
            "treefold_skill" => manifest.components.treefold_skill.clone(),
            "amux_skill" => manifest.components.amux_skill.clone(),
            _ => unreachable!(),
        };
        Self {
            inner: Arc::new(Inner {
                treefold_home: treefold_home.to_path_buf(),
                manifest_path,
                bundle_root,
                components: paths
                    .into_iter()
                    .map(|(id, source, install_path)| ComponentSpec {
                        id,
                        version: version(id),
                        source,
                        install_path,
                    })
                    .collect(),
            }),
        }
    }

    pub fn bundled_bin_dir(&self) -> Option<PathBuf> {
        self.inner
            .components
            .iter()
            .find(|component| component.id == "treefold_cli")
            .and_then(|component| component.source.parent().map(Path::to_path_buf))
    }

    pub fn status(&self) -> anyhow::Result<IntegrationStatus> {
        let manifest: IntegrationManifest =
            serde_json::from_slice(&std::fs::read(&self.inner.manifest_path)?)?;
        let receipt = self.read_receipt();
        let components = self
            .inner
            .components
            .iter()
            .map(|component| self.component_status(component, receipt.as_ref()))
            .collect::<Vec<_>>();
        let managed = components
            .iter()
            .filter(|component| component.install_path.is_some())
            .collect::<Vec<_>>();
        let state = if components
            .iter()
            .any(|component| component.state == IntegrationState::Unavailable)
        {
            IntegrationState::Unavailable
        } else if managed
            .iter()
            .any(|component| component.state == IntegrationState::Conflict)
        {
            IntegrationState::Conflict
        } else if managed
            .iter()
            .all(|component| component.state == IntegrationState::Ready)
        {
            IntegrationState::Ready
        } else if managed
            .iter()
            .all(|component| component.state == IntegrationState::NotInstalled)
        {
            IntegrationState::NotInstalled
        } else if managed
            .iter()
            .any(|component| component.state == IntegrationState::Outdated)
        {
            IntegrationState::Outdated
        } else {
            IntegrationState::Partial
        };
        Ok(IntegrationStatus {
            state,
            app_version: env!("CARGO_PKG_VERSION").into(),
            bundle_version: manifest.bundle_version,
            protocol_version: manifest.protocol_version,
            bundle_path: self.inner.bundle_root.to_string_lossy().into_owned(),
            components,
        })
    }

    pub fn sync(&self) -> Result<IntegrationStatus, IntegrationError> {
        let receipt = self.read_receipt();
        for component in &self.inner.components {
            if !component.source.exists() {
                return Err(IntegrationError::Unavailable(component.source.clone()));
            }
            let Some(target) = &component.install_path else {
                continue;
            };
            match self.link_state(target, &component.source, receipt.as_ref()) {
                LinkState::Ready | LinkState::Missing | LinkState::Owned => {}
                LinkState::Conflict => return Err(IntegrationError::Conflict(target.clone())),
            }
        }
        let mut links = BTreeMap::new();
        for component in &self.inner.components {
            let Some(target) = &component.install_path else {
                continue;
            };
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).map_err(anyhow::Error::from)?;
            }
            if self.link_state(target, &component.source, receipt.as_ref()) != LinkState::Ready {
                replace_symlink(&component.source, target).map_err(anyhow::Error::from)?;
            }
            links.insert(target.clone(), component.source.clone());
        }
        self.write_receipt(&Receipt {
            schema_version: 1,
            bundle_version: self
                .status()
                .map_err(IntegrationError::Other)?
                .bundle_version,
            links,
        })
        .map_err(IntegrationError::Other)?;
        self.status().map_err(IntegrationError::Other)
    }

    pub fn uninstall(&self) -> anyhow::Result<IntegrationStatus> {
        if let Some(receipt) = self.read_receipt() {
            for component in &self.inner.components {
                let Some(target) = &component.install_path else {
                    continue;
                };
                if let Some(owned_source) = receipt.links.get(target)
                    && read_link_absolute(target).as_ref() == Some(owned_source)
                {
                    std::fs::remove_file(target)?;
                }
            }
            let receipt_path = self.receipt_path();
            if receipt_path.exists() {
                std::fs::remove_file(receipt_path)?;
            }
        }
        self.status()
    }

    fn component_status(
        &self,
        component: &ComponentSpec,
        receipt: Option<&Receipt>,
    ) -> ComponentStatus {
        let (state, detail) = if !component.source.exists() {
            (
                IntegrationState::Unavailable,
                Some("Bundled resource is missing".into()),
            )
        } else if let Some(target) = &component.install_path {
            match self.link_state(target, &component.source, receipt) {
                LinkState::Ready => (IntegrationState::Ready, None),
                LinkState::Missing => (IntegrationState::NotInstalled, None),
                LinkState::Owned => (
                    IntegrationState::Outdated,
                    Some("Managed link points to an older App bundle".into()),
                ),
                LinkState::Conflict => (
                    IntegrationState::Conflict,
                    Some("Existing path is not managed by Treefold".into()),
                ),
            }
        } else {
            (
                IntegrationState::Ready,
                Some("Private Session resource; not installed globally".into()),
            )
        };
        ComponentStatus {
            id: component.id.into(),
            version: component.version.clone(),
            source_path: component.source.to_string_lossy().into_owned(),
            install_path: component
                .install_path
                .as_ref()
                .map(|path| path.to_string_lossy().into_owned()),
            state,
            detail,
        }
    }

    fn link_state(&self, target: &Path, desired: &Path, receipt: Option<&Receipt>) -> LinkState {
        if !target.exists() && std::fs::symlink_metadata(target).is_err() {
            return LinkState::Missing;
        }
        let Some(actual) = read_link_absolute(target) else {
            return LinkState::Conflict;
        };
        if actual == desired {
            return LinkState::Ready;
        }
        if receipt
            .and_then(|receipt| receipt.links.get(target))
            .is_some_and(|owned| owned == &actual)
        {
            LinkState::Owned
        } else {
            LinkState::Conflict
        }
    }

    fn receipt_path(&self) -> PathBuf {
        self.inner.treefold_home.join(RECEIPT_FILE)
    }
    fn read_receipt(&self) -> Option<Receipt> {
        std::fs::read(self.receipt_path())
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
    }
    fn write_receipt(&self, receipt: &Receipt) -> anyhow::Result<()> {
        let path = self.receipt_path();
        let parent = path.parent().expect("receipt has parent");
        std::fs::create_dir_all(parent)?;
        let temporary = parent.join(format!("agent-integration.tmp-{}", std::process::id()));
        std::fs::write(&temporary, serde_json::to_vec_pretty(receipt)?)?;
        std::fs::rename(temporary, path)?;
        Ok(())
    }
}

#[derive(PartialEq, Eq)]
enum LinkState {
    Ready,
    Missing,
    Owned,
    Conflict,
}

fn read_link_absolute(path: &Path) -> Option<PathBuf> {
    let target = std::fs::read_link(path).ok()?;
    if target.is_absolute() {
        Some(target)
    } else {
        Some(path.parent()?.join(target))
    }
}

fn replace_symlink(source: &Path, target: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;
        let temporary = target.with_file_name(format!(
            ".{}.treefold-{}",
            target.file_name().unwrap_or_default().to_string_lossy(),
            std::process::id()
        ));
        if std::fs::symlink_metadata(&temporary).is_ok() {
            std::fs::remove_file(&temporary)?;
        }
        symlink(source, &temporary)?;
        std::fs::rename(temporary, target)
    }
    #[cfg(not(unix))]
    {
        let _ = (source, target);
        Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "Agent integration currently requires macOS",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manager(root: &Path) -> IntegrationManager {
        let bundle = root.join("bundle");
        let home = root.join("user");
        let treefold_home = root.join("treefold-home");
        for path in [
            bundle.join("bin/treefold"),
            bundle.join("bin/amux"),
            bundle.join("skills/treefold/SKILL.md"),
            bundle.join("skills/amux/SKILL.md"),
        ] {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, "test").unwrap();
        }
        let manifest = IntegrationManifest {
            schema_version: 1,
            bundle_version: "1".into(),
            protocol_version: "1".into(),
            components: ManifestComponents {
                treefold_cli: "1".into(),
                amux_cli: "1".into(),
                treefold_skill: "1".into(),
                amux_skill: "1".into(),
            },
        };
        let manifest_path = bundle.join("manifest.json");
        std::fs::write(&manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
        IntegrationManager::from_parts(
            &treefold_home,
            bundle.clone(),
            manifest_path,
            manifest,
            vec![
                (
                    "treefold_cli",
                    bundle.join("bin/treefold"),
                    Some(home.join(".local/bin/treefold")),
                ),
                ("amux_cli", bundle.join("bin/amux"), None),
                (
                    "treefold_skill",
                    bundle.join("skills/treefold"),
                    Some(home.join(".agents/skills/treefold")),
                ),
                (
                    "amux_skill",
                    bundle.join("skills/amux"),
                    Some(home.join(".agents/skills/amux")),
                ),
            ],
        )
    }

    #[test]
    fn sync_and_uninstall_only_managed_links() {
        let root = tempfile::tempdir().unwrap();
        let manager = manager(root.path());
        assert_eq!(
            manager.status().unwrap().state,
            IntegrationState::NotInstalled
        );
        assert_eq!(manager.sync().unwrap().state, IntegrationState::Ready);
        assert_eq!(
            manager.uninstall().unwrap().state,
            IntegrationState::NotInstalled
        );
    }

    #[test]
    fn sync_does_not_overwrite_conflicts() {
        let root = tempfile::tempdir().unwrap();
        let manager = manager(root.path());
        let target = root.path().join("user/.local/bin/treefold");
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::write(&target, "mine").unwrap();
        assert!(matches!(manager.sync(), Err(IntegrationError::Conflict(path)) if path == target));
        assert_eq!(std::fs::read_to_string(target).unwrap(), "mine");
    }

    #[test]
    fn uninstall_ignores_receipt_targets_outside_the_manifest() {
        let root = tempfile::tempdir().unwrap();
        let manager = manager(root.path());
        manager.sync().unwrap();
        let outside_source = root.path().join("outside-source");
        let outside_target = root.path().join("outside-target");
        std::fs::write(&outside_source, "keep").unwrap();
        std::os::unix::fs::symlink(&outside_source, &outside_target).unwrap();
        let mut receipt = manager.read_receipt().unwrap();
        receipt.links.insert(outside_target.clone(), outside_source);
        manager.write_receipt(&receipt).unwrap();

        manager.uninstall().unwrap();

        assert!(outside_target.exists());
    }
}
