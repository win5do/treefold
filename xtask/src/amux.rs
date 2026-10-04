use std::{
    env, fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use anyhow::{Context, Result, bail, ensure};
use serde_json::Value;
use tempfile::TempDir;
use toml_edit::{DocumentMut, value};

pub const GIT_URL: &str = "https://github.com/win5do/amux.git";
pub const BACKEND_MANIFEST: &str = "src/backend/Cargo.toml";

pub struct AmuxSource {
    pub manifest: PathBuf,
    pub skill: PathBuf,
    pub version: String,
    pub source: Option<String>,
}

/// One resolved dependency supplies the backend runtime, CLI, and Skill.
/// Local patches and their lockfile are private to this invocation.
pub struct BackendCargo {
    root: PathBuf,
    config: Option<PathBuf>,
    _temporary: Option<TempDir>,
    pub amux: AmuxSource,
}

impl BackendCargo {
    pub fn new(root: &Path) -> Result<Self> {
        let configured = env::var_os("TREEFOLD_AMUX_MANIFEST")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from);
        Self::resolve(root, configured.as_deref())
    }

    fn resolve(root: &Path, configured: Option<&Path>) -> Result<Self> {
        let expected = configured
            .map(|path| {
                let manifest = root.join(path);
                fs::canonicalize(&manifest).with_context(|| {
                    format!("resolve TREEFOLD_AMUX_MANIFEST {}", manifest.display())
                })
            })
            .transpose()?;
        let temporary = expected.as_ref().map(|_| tempfile::tempdir()).transpose()?;
        let config = if let (Some(manifest), Some(temporary)) = (&expected, &temporary) {
            let document = fs::read_to_string(manifest)?.parse::<DocumentMut>()?;
            ensure!(
                document
                    .get("package")
                    .and_then(|package| package.get("name"))
                    .and_then(|name| name.as_str())
                    == Some("amux-runtime"),
                "TREEFOLD_AMUX_MANIFEST must name the amux-runtime package"
            );
            let lockfile = temporary.path().join("Cargo.lock");
            seed_local_lock(&root.join("src/backend/Cargo.lock"), &lockfile)?;
            let mut config = DocumentMut::new();
            config["patch"][GIT_URL]["amux-runtime"]["path"] = value(
                manifest
                    .parent()
                    .context("amux manifest has no parent")?
                    .to_str()
                    .context("amux path is not UTF-8")?,
            );
            config["resolver"]["lockfile-path"] =
                value(lockfile.to_str().context("lockfile path is not UTF-8")?);
            let path = temporary.path().join("config.toml");
            fs::write(&path, config.to_string())?;
            Some(path)
        } else {
            None
        };

        let mut command = cargo(root);
        if let Some(config) = &config {
            command.arg("--config").arg(config);
        }
        command.args([
            "metadata",
            "--format-version",
            "1",
            "--manifest-path",
            BACKEND_MANIFEST,
        ]);
        if expected.is_none() {
            command.arg("--locked");
        }
        let output = command
            .stderr(Stdio::inherit())
            .output()
            .context("resolve backend amux dependency")?;
        ensure!(
            output.status.success(),
            "resolve backend amux dependency exited with {}",
            output.status
        );
        let metadata: Value = serde_json::from_slice(&output.stdout)?;
        let amux = source_from_metadata(&metadata, expected.as_deref())?;
        eprintln!(
            "Using amux {} from {} ({})",
            amux.version,
            amux.manifest.display(),
            amux.source.as_deref().unwrap_or("local")
        );
        Ok(Self {
            root: root.to_path_buf(),
            config,
            _temporary: temporary,
            amux,
        })
    }

    pub fn command(&self) -> Command {
        let mut command = cargo(&self.root);
        self.configure(&mut command);
        command
    }

    /// Also used after `cargo sqlx prepare --`, so its child cargo check sees
    /// the same patch and isolated lockfile.
    pub fn configure(&self, command: &mut Command) {
        if let Some(config) = &self.config {
            command.arg("--config").arg(config);
        }
        command.env("TREEFOLD_RESOLVED_AMUX_MANIFEST", &self.amux.manifest);
    }

    pub fn write_source(&self, destination: &Path) -> Result<()> {
        fs::write(
            destination,
            serde_json::to_vec_pretty(&serde_json::json!({
                "manifest_path": self.amux.manifest,
                "version": self.amux.version,
                "source": self.amux.source,
            }))?,
        )
        .context("write resolved amux source")
    }
}

fn cargo(root: &Path) -> Command {
    let mut command = Command::new(env::var_os("CARGO").unwrap_or_else(|| "cargo".into()));
    command.current_dir(root);
    command
}

pub fn seed_local_lock(source: &Path, destination: &Path) -> Result<()> {
    let mut lock = fs::read_to_string(source)?.parse::<DocumentMut>()?;
    // An existing Git package lock can prevent a different local package
    // version from being patched in. Preserve all other dependency pins.
    if let Some(packages) = lock
        .get_mut("package")
        .and_then(|item| item.as_array_of_tables_mut())
    {
        packages.retain(|package| {
            package.get("name").and_then(|item| item.as_str()) != Some("amux-runtime")
        });
    }
    fs::write(destination, lock.to_string()).context("seed local amux lockfile")
}

fn source_from_metadata(metadata: &Value, expected: Option<&Path>) -> Result<AmuxSource> {
    let resolve = &metadata["resolve"];
    let root = resolve["root"]
        .as_str()
        .context("backend metadata has no root")?;
    let node = resolve["nodes"]
        .as_array()
        .context("backend metadata has no nodes")?
        .iter()
        .find(|node| node["id"].as_str() == Some(root))
        .context("backend resolve node is missing")?;
    let id = node["deps"]
        .as_array()
        .context("backend metadata has no dependencies")?
        .iter()
        .find(|dep| dep["name"].as_str() == Some("amux"))
        .and_then(|dep| dep["pkg"].as_str())
        .context("backend has no amux dependency")?;
    let package = metadata["packages"]
        .as_array()
        .context("backend metadata has no packages")?
        .iter()
        .find(|package| package["id"].as_str() == Some(id))
        .context("resolved amux package is missing")?;
    ensure!(
        package["name"].as_str() == Some("amux-runtime"),
        "backend amux dependency must be amux-runtime"
    );
    let manifest = fs::canonicalize(
        package["manifest_path"]
            .as_str()
            .context("amux manifest is missing")?,
    )?;
    let source = package["source"].as_str().map(str::to_owned);
    if let Some(expected) = expected {
        ensure!(
            manifest == expected && source.is_none(),
            "backend amux resolved to {}, expected local {}",
            manifest.display(),
            expected.display()
        );
    } else {
        let prefix = format!("git+{GIT_URL}?branch=main#");
        ensure!(
            source
                .as_ref()
                .is_some_and(|source| source.starts_with(&prefix)),
            "backend amux must resolve to GitHub main; use TREEFOLD_AMUX_MANIFEST for local development"
        );
    }
    let skill = manifest
        .parent()
        .context("amux manifest has no parent")?
        .join("skills/amux");
    ensure!(
        skill.join("SKILL.md").is_file(),
        "amux Skill is required at {}",
        skill.display()
    );
    Ok(AmuxSource {
        manifest,
        skill,
        source,
        version: package["version"]
            .as_str()
            .context("amux version is missing")?
            .to_owned(),
    })
}

pub fn run_backend(root: &Path, subcommand: &str, args: Vec<String>) -> Result<()> {
    ensure!(
        ["build", "check", "test", "clippy", "run"].contains(&subcommand),
        "backend supports build, check, test, clippy, or run"
    );
    if args
        .iter()
        .any(|arg| arg == "--manifest-path" || arg.starts_with("--manifest-path="))
    {
        bail!("backend manifest is selected by xtask");
    }
    let backend = BackendCargo::new(root)?;
    super::run_command(
        backend
            .command()
            .arg(subcommand)
            .args(["--locked", "--manifest-path", BACKEND_MANIFEST])
            .args(args),
        "run backend Cargo command",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn local_lock_releases_only_amux_and_preserves_committed_pins() {
        let root = tempfile::tempdir().unwrap();
        let original = "version = 4\n\n[[package]]\nname = \"amux-runtime\"\nversion = \"0.1.0-alpha.1\"\nsource = \"git+https://github.com/win5do/amux.git?branch=main#1234\"\n\n[[package]]\nname = \"anyhow\"\nversion = \"1.0.100\"\n";
        let source = root.path().join("committed.lock");
        let destination = root.path().join("Cargo.lock");
        fs::write(&source, original).unwrap();
        seed_local_lock(&source, &destination).unwrap();
        assert_eq!(fs::read_to_string(&source).unwrap(), original);
        let local = fs::read_to_string(destination)
            .unwrap()
            .parse::<DocumentMut>()
            .unwrap();
        let packages = local["package"].as_array_of_tables().unwrap();
        assert_eq!(packages.len(), 1);
        assert_eq!(packages.get(0).unwrap()["name"].as_str(), Some("anyhow"));
        assert_eq!(
            packages.get(0).unwrap()["version"].as_str(),
            Some("1.0.100")
        );
    }

    fn fixture() -> (TempDir, PathBuf, Value) {
        let root = tempfile::tempdir().unwrap();
        let checkout = root.path().join("worktrees/amux with spaces");
        fs::create_dir_all(checkout.join("skills/amux")).unwrap();
        fs::write(checkout.join("skills/amux/SKILL.md"), "local skill").unwrap();
        fs::write(checkout.join("Cargo.toml"), "").unwrap();
        let manifest = fs::canonicalize(checkout.join("Cargo.toml")).unwrap();
        let metadata = json!({
            "resolve": {"root": "backend", "nodes": [{"id": "backend", "deps": [{"name": "amux", "pkg": "selected"}]}]},
            "packages": [
                {"id": "unrelated", "name": "amux-runtime", "manifest_path": "/wrong/Cargo.toml"},
                {"id": "selected", "name": "amux-runtime", "version": "0.1.0-alpha.1", "source": null, "manifest_path": manifest}
            ]
        });
        (root, manifest, metadata)
    }

    #[test]
    fn selects_backend_dependency_by_id_and_uses_its_skill() {
        let (_root, manifest, metadata) = fixture();
        let source = source_from_metadata(&metadata, Some(&manifest)).unwrap();
        assert_eq!(source.manifest, manifest);
        assert_eq!(
            fs::read_to_string(source.skill.join("SKILL.md")).unwrap(),
            "local skill"
        );
    }

    #[test]
    fn refuses_silent_fallback_or_another_local_worktree() {
        let (_root, manifest, mut metadata) = fixture();
        assert!(source_from_metadata(&metadata, Some(Path::new("/another/Cargo.toml"))).is_err());
        assert!(source_from_metadata(&metadata, None).is_err());
        metadata["packages"][1]["source"] = format!("git+{GIT_URL}?branch=main#1234").into();
        assert!(source_from_metadata(&metadata, Some(&manifest)).is_err());
        assert!(source_from_metadata(&metadata, None).is_ok());
        metadata["packages"][1]["source"] = format!("git+{GIT_URL}?branch=other#1234").into();
        assert!(source_from_metadata(&metadata, None).is_err());
    }

    #[test]
    fn rejects_missing_skill_and_invalid_override_before_building() {
        let (root, manifest, metadata) = fixture();
        fs::remove_file(manifest.parent().unwrap().join("skills/amux/SKILL.md")).unwrap();
        assert!(source_from_metadata(&metadata, Some(&manifest)).is_err());
        assert!(BackendCargo::resolve(root.path(), Some(Path::new("missing/Cargo.toml"))).is_err());
        fs::write(&manifest, "[workspace]\n").unwrap();
        let error = BackendCargo::resolve(root.path(), Some(&manifest))
            .err()
            .unwrap();
        assert!(error.to_string().contains("amux-runtime"));
    }
}
