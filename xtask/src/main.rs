use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};

use anyhow::{Context, Result, bail};
use serde_json::Value;
use toml_edit::DocumentMut;

const TREEFOLD_MANIFEST: &str = "cli/Cargo.toml";
const DEFAULT_AMUX_MANIFEST: &str = "../amux/Cargo.toml";
const TARGET_DIR: &str = "src-tauri/target";
const DEV_STAGING: &str = "src-tauri/bundle-staging/dev-sidecars";
const BUNDLE_STAGING: &str = "src-tauri/bundle-staging/agent-integration";
const INTEGRATION_MANIFEST: &str = "src-tauri/resources/agent-integration/manifest.json";

fn main() {
    if let Err(error) = run() {
        eprintln!("treefold xtask failed: {error:#}");
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let mut args = env::args().skip(1);
    match (args.next().as_deref(), args.next().as_deref()) {
        (Some("sidecars"), Some("dev")) => prepare_dev_sidecars(args.collect()),
        (Some("sidecars"), Some("bundle")) => {
            if let Some(argument) = args.next() {
                bail!("unexpected argument for sidecars bundle: {argument}");
            }
            prepare_bundle_sidecars()
        }
        _ => bail!("usage: cargo xtask sidecars <dev [-- TAURI_ARGS...]|bundle>"),
    }
}

#[derive(Debug, PartialEq, Eq)]
enum Profile {
    Debug,
    Release,
}

impl Profile {
    fn directory(&self) -> &'static str {
        match self {
            Self::Debug => "debug",
            Self::Release => "release",
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
struct BuildOptions {
    profile: Profile,
    target: Option<String>,
}

impl BuildOptions {
    fn artifact_dir(&self, target_dir: &Path) -> PathBuf {
        let mut path = target_dir.to_path_buf();
        if let Some(target) = &self.target {
            path.push(target);
        }
        path.push(self.profile.directory());
        path
    }
}

struct AmuxSource {
    manifest: PathBuf,
    skill: PathBuf,
    version: String,
}

fn repository_root() -> Result<PathBuf> {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(Path::to_path_buf)
        .context("xtask manifest directory has no parent")
}

fn prepare_dev_sidecars(args: Vec<String>) -> Result<()> {
    let root = repository_root()?;
    let options = parse_dev_options(&args)?;
    let amux = resolve_amux(&root)?;
    let target_dir = root.join(TARGET_DIR);
    build_sidecars(&root, &amux, &target_dir, &options)?;

    let artifact_dir = options.artifact_dir(&target_dir);
    let staging = root.join(DEV_STAGING);
    replace_staging_dir(&staging, |temporary| {
        let bin = temporary.join("bin");
        fs::create_dir_all(&bin).with_context(|| format!("create {}", bin.display()))?;
        copy_file(&artifact_dir.join("treefold"), &bin.join("treefold"))?;
        copy_file(&artifact_dir.join("amux"), &bin.join("amux"))?;
        copy_tree(&amux.skill, &temporary.join("skills/amux"))
    })?;

    eprintln!("Prepared development sidecars in {}", staging.display());
    Ok(())
}

fn prepare_bundle_sidecars() -> Result<()> {
    let root = repository_root()?;
    let host = rust_host_target()?;
    let options = BuildOptions {
        profile: Profile::Release,
        target: Some(host.clone()),
    };
    let amux = resolve_amux(&root)?;
    let target_dir = root.join(TARGET_DIR);
    build_sidecars(&root, &amux, &target_dir, &options)?;

    let artifact_dir = options.artifact_dir(&target_dir);
    let binaries = root.join("src-tauri/binaries");
    fs::create_dir_all(&binaries).with_context(|| format!("create {}", binaries.display()))?;
    copy_file(
        &artifact_dir.join("treefold"),
        &binaries.join(format!("treefold-{host}")),
    )?;
    copy_file(
        &artifact_dir.join("amux"),
        &binaries.join(format!("amux-{host}")),
    )?;

    let staging = root.join(BUNDLE_STAGING);
    replace_staging_dir(&staging, |temporary| {
        copy_tree(&amux.skill, &temporary.join("skills/amux"))?;
        stage_integration_manifest(&root, temporary, &amux.version)
    })?;

    eprintln!("Prepared release sidecars for {host}");
    Ok(())
}

fn parse_dev_options(args: &[String]) -> Result<BuildOptions> {
    let mut profile = Profile::Debug;
    let mut target = None;
    let mut index = usize::from(args.first().is_some_and(|argument| argument == "--"));

    while index < args.len() {
        let argument = &args[index];
        if argument == "--" {
            break;
        }
        match argument.as_str() {
            "--release" => profile = Profile::Release,
            "--target" | "-t" => {
                index += 1;
                let value = args
                    .get(index)
                    .filter(|value| !value.is_empty())
                    .context("--target requires a value")?;
                target = Some(value.clone());
            }
            _ => {
                if let Some(value) = argument.strip_prefix("--target=") {
                    if value.is_empty() {
                        bail!("--target requires a value");
                    }
                    target = Some(value.to_owned());
                }
            }
        }
        index += 1;
    }

    Ok(BuildOptions { profile, target })
}

fn resolve_amux(root: &Path) -> Result<AmuxSource> {
    let configured = env::var_os("TREEFOLD_AMUX_MANIFEST")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(DEFAULT_AMUX_MANIFEST));
    let manifest = if configured.is_absolute() {
        configured
    } else {
        root.join(configured)
    };
    if !manifest.is_file() {
        bail!(
            "amux source is required at {}; set TREEFOLD_AMUX_MANIFEST",
            manifest.display()
        );
    }
    let amux_root = manifest.parent().context("amux manifest has no parent")?;
    let skill = amux_root.join("skills/amux");
    if !skill.join("SKILL.md").is_file() {
        bail!("amux Skill is required at {}", skill.display());
    }
    let document = fs::read_to_string(&manifest)
        .with_context(|| format!("read {}", manifest.display()))?
        .parse::<DocumentMut>()
        .with_context(|| format!("parse {}", manifest.display()))?;
    let version = document
        .get("package")
        .and_then(|package| package.get("version"))
        .and_then(|version| version.as_str())
        .context("amux package.version is missing")?
        .to_owned();

    Ok(AmuxSource {
        manifest,
        skill,
        version,
    })
}

fn build_sidecars(
    root: &Path,
    amux: &AmuxSource,
    target_dir: &Path,
    options: &BuildOptions,
) -> Result<()> {
    build_binary(
        root,
        &root.join(TREEFOLD_MANIFEST),
        "treefold",
        target_dir,
        options,
    )?;
    build_binary(root, &amux.manifest, "amux", target_dir, options)
}

fn build_binary(
    root: &Path,
    manifest: &Path,
    binary: &str,
    target_dir: &Path,
    options: &BuildOptions,
) -> Result<()> {
    eprintln!("Preparing {binary} sidecar");
    let cargo = env::var_os("CARGO").unwrap_or_else(|| "cargo".into());
    let mut command = Command::new(cargo);
    command
        .current_dir(root)
        .arg("build")
        .arg("--target-dir")
        .arg(target_dir)
        .arg("--bin")
        .arg(binary)
        .arg("--manifest-path")
        .arg(manifest);
    if options.profile == Profile::Release {
        command.arg("--release");
    }
    if let Some(target) = &options.target {
        command.arg("--target").arg(target);
    }
    let status = command
        .status()
        .with_context(|| format!("run cargo build for {binary}"))?;
    if !status.success() {
        bail!("cargo build for {binary} exited with {status}");
    }
    Ok(())
}

fn rust_host_target() -> Result<String> {
    let output = Command::new("rustc")
        .arg("-vV")
        .output()
        .context("run rustc -vV")?;
    if !output.status.success() {
        bail!("rustc -vV exited with {}", output.status);
    }
    let stdout = String::from_utf8(output.stdout).context("rustc output is not UTF-8")?;
    stdout
        .lines()
        .find_map(|line| line.strip_prefix("host: "))
        .map(str::to_owned)
        .context("rustc did not report its host target")
}

fn stage_integration_manifest(root: &Path, staging: &Path, amux_version: &str) -> Result<()> {
    let source = root.join(INTEGRATION_MANIFEST);
    let mut manifest: Value = serde_json::from_slice(
        &fs::read(&source).with_context(|| format!("read {}", source.display()))?,
    )
    .with_context(|| format!("parse {}", source.display()))?;
    let object = manifest
        .as_object_mut()
        .context("integration manifest must be a JSON object")?;
    if let Some(build_version) = env::var("TREEFOLD_BUILD_VERSION")
        .ok()
        .filter(|version| !version.is_empty())
    {
        object.insert("bundle_version".into(), build_version.clone().into());
        object
            .get_mut("components")
            .and_then(Value::as_object_mut)
            .context("integration manifest components must be an object")?
            .insert("treefold_cli".into(), build_version.into());
    }
    let components = object
        .get_mut("components")
        .and_then(Value::as_object_mut)
        .context("integration manifest components must be an object")?;
    components.insert("amux_cli".into(), amux_version.into());
    components.insert("amux_skill".into(), amux_version.into());

    let mut bytes = serde_json::to_vec_pretty(&manifest)?;
    bytes.push(b'\n');
    let destination = staging.join("manifest.json");
    fs::write(&destination, bytes).with_context(|| format!("write {}", destination.display()))
}

fn replace_staging_dir(
    destination: &Path,
    populate: impl FnOnce(&Path) -> Result<()>,
) -> Result<()> {
    let parent = destination
        .parent()
        .context("staging directory has no parent")?;
    fs::create_dir_all(parent).with_context(|| format!("create {}", parent.display()))?;
    let name = destination
        .file_name()
        .context("staging directory has no file name")?
        .to_string_lossy();
    let temporary = parent.join(format!(".{name}.tmp-{}", std::process::id()));
    if temporary.exists() {
        fs::remove_dir_all(&temporary)
            .with_context(|| format!("remove {}", temporary.display()))?;
    }
    fs::create_dir_all(&temporary).with_context(|| format!("create {}", temporary.display()))?;
    if let Err(error) = populate(&temporary) {
        let _ = fs::remove_dir_all(&temporary);
        return Err(error);
    }
    if destination.exists() {
        fs::remove_dir_all(destination)
            .with_context(|| format!("remove {}", destination.display()))?;
    }
    fs::rename(&temporary, destination).with_context(|| {
        format!(
            "rename {} to {}",
            temporary.display(),
            destination.display()
        )
    })
}

fn copy_file(source: &Path, destination: &Path) -> Result<()> {
    fs::copy(source, destination)
        .with_context(|| format!("copy {} to {}", source.display(), destination.display()))?;
    Ok(())
}

fn copy_tree(source: &Path, destination: &Path) -> Result<()> {
    fs::create_dir_all(destination).with_context(|| format!("create {}", destination.display()))?;
    for entry in fs::read_dir(source).with_context(|| format!("read {}", source.display()))? {
        let entry = entry?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            copy_tree(&source_path, &destination_path)?;
        } else if file_type.is_file() {
            copy_file(&source_path, &destination_path)?;
        } else {
            bail!("unsupported file type in Skill: {}", source_path.display());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tauri_target_and_release_options() {
        assert_eq!(
            parse_dev_options(&[
                "--".into(),
                "--no-watch".into(),
                "--target=aarch64-apple-darwin".into(),
                "--release".into(),
            ])
            .unwrap(),
            BuildOptions {
                profile: Profile::Release,
                target: Some("aarch64-apple-darwin".into()),
            }
        );
    }

    #[test]
    fn ignores_options_after_tauri_app_argument_boundary() {
        assert_eq!(
            parse_dev_options(&[
                "--".into(),
                "--no-watch".into(),
                "--".into(),
                "--release".into(),
                "--target".into(),
                "ignored".into(),
            ])
            .unwrap(),
            BuildOptions {
                profile: Profile::Debug,
                target: None,
            }
        );
    }
}
