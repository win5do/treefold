use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};

use anyhow::{Context, Result, bail};
use serde_json::Value;
mod amux;
use amux::{BACKEND_MANIFEST, BackendCargo};

const TREEFOLD_MANIFEST: &str = "src/cli/Cargo.toml";
const TARGET_DIR: &str = "src/backend/target";
const DEV_STAGING: &str = "src/backend/bundle-staging/dev-sidecars";
const BUNDLE_STAGING: &str = "src/backend/bundle-staging/agent-integration";
const INTEGRATION_MANIFEST: &str = "src/backend/resources/agent-integration/manifest.json";

fn main() {
    if let Err(error) = run() {
        eprintln!("treefold xtask failed: {error:#}");
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let mut args = env::args().skip(1);
    match (args.next().as_deref(), args.next().as_deref()) {
        (Some("backend"), Some(command)) => {
            amux::run_backend(&repository_root()?, command, args.collect())
        }
        (Some("sidecars"), Some("dev")) => prepare_dev_sidecars(args.collect()),
        (Some("sidecars"), Some("bundle")) => {
            if let Some(argument) = args.next() {
                bail!("unexpected argument for sidecars bundle: {argument}");
            }
            prepare_bundle_sidecars()
        }
        (Some("database"), Some("prepare")) => database_prepare(false, args.collect()),
        (Some("database"), Some("check")) => database_prepare(true, args.collect()),
        _ => bail!(
            "usage: cargo xtask <backend <build|check|test|clippy|run> [ARGS...]|sidecars <dev [-- BUILD_ARGS...]|bundle>|database <prepare|check>>"
        ),
    }
}

fn database_prepare(check: bool, remaining: Vec<String>) -> Result<()> {
    if let Some(argument) = remaining.first() {
        bail!("unexpected argument for database command: {argument}");
    }
    let root = repository_root()?;
    let backend = BackendCargo::new(&root)?;
    let source = root.join("src/backend/migrations/g2");
    let crate_dir = root.join("src/backend");
    let temporary = tempfile::tempdir().context("create temporary database directory")?;
    let database = temporary.path().join("treefold_2.sqlite");
    let database_url = format!("sqlite://{}", database.display());

    run_command(
        Command::new("cargo")
            .current_dir(&root)
            .args(["sqlx", "database", "create", "--database-url"])
            .arg(&database_url),
        "create temporary SQLx database",
    )?;
    run_command(
        Command::new("cargo")
            .current_dir(&root)
            .args(["sqlx", "migrate", "run", "--source"])
            .arg(&source)
            .arg("--database-url")
            .arg(&database_url),
        "apply generation 2 migrations",
    )?;

    let mut command = Command::new("cargo");
    command
        .current_dir(&crate_dir)
        .args(["sqlx", "prepare", "--database-url"])
        .arg(&database_url);
    if check {
        command.arg("--check");
    }
    command.args(["--", "--all-targets", "--locked"]);
    backend.configure(&mut command);
    run_command(
        &mut command,
        if check {
            "check SQLx offline metadata"
        } else {
            "prepare SQLx offline metadata"
        },
    )?;
    eprintln!(
        "SQLx metadata {} for database generation 2",
        if check { "is current" } else { "was updated" }
    );
    Ok(())
}

fn run_command(command: &mut Command, description: &str) -> Result<()> {
    let status = command
        .status()
        .with_context(|| format!("{description}: failed to start command"))?;
    if !status.success() {
        bail!("{description}: command exited with {status}");
    }
    Ok(())
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

fn repository_root() -> Result<PathBuf> {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(Path::to_path_buf)
        .context("xtask manifest directory has no parent")
}

fn prepare_dev_sidecars(args: Vec<String>) -> Result<()> {
    let root = repository_root()?;
    let options = parse_dev_options(&args)?;
    let backend = BackendCargo::new(&root)?;
    let amux = &backend.amux;
    let target_dir = root.join(TARGET_DIR);
    build_sidecars(&root, &backend, &target_dir, &options)?;

    let artifact_dir = options.artifact_dir(&target_dir);
    let staging = root.join(DEV_STAGING);
    replace_staging_dir(&staging, |temporary| {
        let bin = temporary.join("bin");
        fs::create_dir_all(&bin).with_context(|| format!("create {}", bin.display()))?;
        copy_file(&artifact_dir.join("treefold"), &bin.join("treefold"))?;
        copy_file(&artifact_dir.join("amux"), &bin.join("amux"))?;
        let integration = temporary.join("agent-integration");
        copy_tree(&amux.skill, &integration.join("skills/amux"))?;
        copy_tree(
            &root.join("src/cli/skills/treefold"),
            &integration.join("skills/treefold"),
        )?;
        stage_integration_manifest(&root, &integration, &amux.version)?;
        backend.write_source(&temporary.join("amux-source.json"))
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
    let backend = BackendCargo::new(&root)?;
    let amux = &backend.amux;
    let target_dir = root.join(TARGET_DIR);
    build_sidecars(&root, &backend, &target_dir, &options)?;

    let artifact_dir = options.artifact_dir(&target_dir);
    let binaries = root.join("src/backend/bundle-staging/bin");
    fs::create_dir_all(&binaries)?;
    for name in ["treefold", "amux", "treefold-backend"] {
        copy_file(&artifact_dir.join(name), &binaries.join(name))?;
    }

    let staging = root.join(BUNDLE_STAGING);
    replace_staging_dir(&staging, |temporary| {
        copy_tree(&amux.skill, &temporary.join("skills/amux"))?;
        copy_tree(
            &root.join("src/cli/skills/treefold"),
            &temporary.join("skills/treefold"),
        )?;
        backend.write_source(&temporary.join("amux-source.json"))?;
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

fn cargo_build(root: &Path) -> Command {
    let mut command = Command::new(env::var_os("CARGO").unwrap_or_else(|| "cargo".into()));
    command.current_dir(root).arg("build");
    command
}

fn build_sidecars(
    root: &Path,
    backend: &BackendCargo,
    target_dir: &Path,
    options: &BuildOptions,
) -> Result<()> {
    let mut treefold = cargo_build(root);
    treefold.arg("--locked");
    build_binary(
        treefold,
        &root.join(TREEFOLD_MANIFEST),
        "treefold",
        target_dir,
        options,
    )?;

    let mut amux = cargo_build(root);
    // Local package/dependency changes may require resolving the CLI lock too.
    // Keep those writes out of the selected worktree and Cargo's Git cache.
    let local_lock = if backend.amux.source.is_none() {
        let temporary = tempfile::tempdir()?;
        let lockfile = temporary.path().join("Cargo.lock");
        let source = backend.amux.manifest.with_file_name("Cargo.lock");
        if source.is_file() {
            amux::seed_local_lock(&source, &lockfile)?;
        }
        amux.env("CARGO_RESOLVER_LOCKFILE_PATH", lockfile);
        Some(temporary)
    } else {
        amux.arg("--locked");
        None
    };
    build_binary(amux, &backend.amux.manifest, "amux", target_dir, options)?;
    drop(local_lock);

    let mut command = backend.command();
    command.args(["build", "--locked"]);
    build_binary(
        command,
        &root.join(BACKEND_MANIFEST),
        "treefold-backend",
        target_dir,
        options,
    )
}

fn build_binary(
    mut command: Command,
    manifest: &Path,
    binary: &str,
    target_dir: &Path,
    options: &BuildOptions,
) -> Result<()> {
    eprintln!("Preparing {binary} sidecar");
    command
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
    run_command(&mut command, &format!("cargo build for {binary}"))
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
            // On macOS fs::copy can clone the file and emit a source-side
            // FSEvent. Do not notify file watchers about unchanged Skill source
            // files while staging; retain executable script modes as well.
            fs::write(&destination_path, fs::read(&source_path)?)
                .with_context(|| format!("copy Skill {}", source_path.display()))?;
            fs::set_permissions(&destination_path, fs::metadata(&source_path)?.permissions())?;
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
    #[cfg(unix)]
    fn skill_staging_preserves_executable_scripts() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("skill/scripts");
        fs::create_dir_all(&source).unwrap();
        let script = source.join("run.sh");
        fs::write(&script, "#!/bin/sh\nexit 0\n").unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
        let destination = root.path().join("staged");
        copy_tree(&root.path().join("skill"), &destination).unwrap();
        let staged = destination.join("scripts/run.sh");
        assert_eq!(fs::read(&staged).unwrap(), fs::read(&script).unwrap());
        assert_eq!(
            fs::metadata(staged).unwrap().permissions().mode() & 0o777,
            0o755
        );
    }

    #[test]
    fn parses_build_target_and_release_options() {
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
    fn ignores_options_after_build_argument_boundary() {
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
