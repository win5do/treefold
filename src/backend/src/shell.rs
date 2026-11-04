use std::ffi::{CStr, CString, OsString};
use std::os::unix::ffi::{OsStrExt, OsStringExt};
use std::path::PathBuf;

fn executable(path: &std::path::Path) -> bool {
    if !path.is_absolute() || !path.is_file() {
        return false;
    }
    let Ok(path) = CString::new(path.as_os_str().as_bytes()) else {
        return false;
    };
    // access checks the current user's ability to execute, including ACLs.
    unsafe { libc::access(path.as_ptr(), libc::X_OK) == 0 }
}

fn login_shell() -> Option<OsString> {
    let mut buffer = vec![0u8; 4096];
    loop {
        let mut entry = std::mem::MaybeUninit::<libc::passwd>::uninit();
        let mut result = std::ptr::null_mut();
        // getpwuid_r writes into caller-owned storage and is safe across workers.
        let code = unsafe {
            libc::getpwuid_r(
                libc::getuid(),
                entry.as_mut_ptr(),
                buffer.as_mut_ptr().cast(),
                buffer.len(),
                &mut result,
            )
        };
        if code == libc::ERANGE && buffer.len() < 1024 * 1024 {
            buffer.resize(buffer.len() * 2, 0);
            continue;
        }
        if code != 0 || result.is_null() {
            return None;
        }
        let entry = unsafe { entry.assume_init() };
        if entry.pw_shell.is_null() {
            return None;
        }
        return Some(OsString::from_vec(
            unsafe { CStr::from_ptr(entry.pw_shell) }
                .to_bytes()
                .to_vec(),
        ));
    }
}

fn select(candidates: impl IntoIterator<Item = OsString>) -> anyhow::Result<PathBuf> {
    candidates
        .into_iter()
        .map(PathBuf::from)
        .find(|path| executable(path))
        .ok_or_else(|| anyhow::anyhow!("No executable login shell, bash, or sh is available"))
}

pub fn default_shell() -> anyhow::Result<String> {
    let shell = select(
        std::env::var_os("SHELL")
            .into_iter()
            .chain(login_shell())
            .chain([OsString::from("/bin/bash"), OsString::from("/bin/sh")]),
    )?;
    shell
        .into_os_string()
        .into_string()
        .map_err(|_| anyhow::anyhow!("The login shell path is not valid UTF-8"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn skips_missing_relative_and_non_executable_shells() {
        let root = tempfile::tempdir().unwrap();
        let invalid = root.path().join("not-executable");
        let preferred = root.path().join("preferred shell");
        std::fs::write(&invalid, "").unwrap();
        std::fs::set_permissions(&invalid, std::fs::Permissions::from_mode(0o644)).unwrap();
        std::fs::write(&preferred, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&preferred, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(
            select([
                "relative".into(),
                root.path().join("missing").into_os_string(),
                invalid.into_os_string(),
                preferred.clone().into_os_string(),
                "/bin/sh".into(),
            ])
            .unwrap(),
            preferred
        );
        assert_eq!(
            select(["".into(), "/bin/sh".into()]).unwrap(),
            PathBuf::from("/bin/sh")
        );
    }

    #[test]
    fn resolves_account_shell_or_fallback_without_environment() {
        assert!(select(login_shell().into_iter().chain(["/bin/sh".into()])).is_ok());
        assert!(select([]).is_err());
    }
}
