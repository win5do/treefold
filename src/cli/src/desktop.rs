use std::{
    env, fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use crate::CliError;
use std::os::unix::process::CommandExt;

fn bundled_launcher(executable: &Path) -> Option<PathBuf> {
    let resources = executable.parent()?.parent()?;
    if let Ok(launcher) = fs::read_to_string(resources.join("desktop-path")) {
        let launcher = PathBuf::from(launcher);
        if launcher.is_absolute() && launcher.is_file() {
            return Some(launcher);
        }
    }
    let launcher = resources.parent()?.join("treefold-desktop");
    launcher.is_file().then_some(launcher)
}

pub(super) fn open(directory: Option<PathBuf>) -> Result<(), CliError> {
    let launcher = env::var_os("TREEFOLD_DESKTOP_PATH")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            env::current_exe()
                .ok()
                .and_then(|exe| bundled_launcher(&exe))
        })
        .unwrap_or_else(|| PathBuf::from("treefold-desktop"));
    let mut command = Command::new(&launcher);
    if let Some(directory) = directory {
        let mut argument = std::ffi::OsString::from("--open-directory=");
        argument.push(directory);
        command.arg(argument);
    }
    command
        .process_group(0)
        .env_remove("ELECTRON_RUN_AS_NODE")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| {
            CliError::unavailable(format!(
                "open Treefold ({}): {error}. Install Treefold or set TREEFOLD_DESKTOP_PATH to its executable or AppImage",
                launcher.display()
            ))
        })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovers_installed_and_persistent_appimage_launchers() {
        let root = env::temp_dir().join(format!("treefold-launcher-{}", std::process::id()));
        let resources = root.join("resources");
        fs::create_dir_all(resources.join("bin")).unwrap();
        let cli = resources.join("bin/treefold");
        assert_eq!(bundled_launcher(&cli), None);
        let installed = root.join("treefold-desktop");
        fs::write(&installed, "").unwrap();
        assert_eq!(bundled_launcher(&cli), Some(installed));
        let appimage = root.join("Treefold with spaces.AppImage");
        fs::write(&appimage, "").unwrap();
        fs::write(resources.join("desktop-path"), appimage.to_str().unwrap()).unwrap();
        assert_eq!(bundled_launcher(&cli), Some(appimage));
        fs::remove_dir_all(root).unwrap();
    }
}
