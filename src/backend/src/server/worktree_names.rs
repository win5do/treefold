use std::{
    io,
    path::{Path, PathBuf},
};

use crate::{error::Result, settings::SettingsStore};

/// An atomically reserved namespace shared by a Workspace's repository checkouts.
pub(super) struct WorktreeRoot(PathBuf);

impl WorktreeRoot {
    pub(super) fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for WorktreeRoot {
    fn drop(&mut self) {
        // Release failed, empty reservations without ever deleting a checkout.
        let _ = std::fs::remove_dir(&self.0);
    }
}

fn random_name() -> String {
    let mut name = String::with_capacity(8);
    while name.len() < 8 {
        for byte in uuid::Uuid::new_v4().as_bytes().iter().take(6) {
            // Rejection sampling avoids modulo bias for the 26-letter alphabet.
            if *byte < 234 {
                name.push((b'a' + byte % 26) as char);
                if name.len() == 8 {
                    break;
                }
            }
        }
    }
    name
}

pub(super) fn reserve_worktree_root(settings: &SettingsStore) -> Result<WorktreeRoot> {
    reserve_in(&settings.treefold_home().join("git/w"), random_name)
        .map_err(|error| anyhow::anyhow!("reserve worktree directory: {error}").into())
}

fn reserve_in(root: &Path, mut next_name: impl FnMut() -> String) -> io::Result<WorktreeRoot> {
    std::fs::create_dir_all(root)?;
    for _ in 0..32 {
        let path = root.join(next_name());
        match std::fs::create_dir(&path) {
            Ok(()) => return Ok(WorktreeRoot(path)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "could not allocate a worktree directory",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn worktree_names_are_eight_lowercase_letters() {
        for _ in 0..100 {
            let name = random_name();
            assert_eq!(name.len(), 8);
            assert!(name.bytes().all(|byte| byte.is_ascii_lowercase()));
        }
    }

    #[test]
    fn worktree_names_retry_conflicts_and_preserve_existing_contents() {
        let root = tempfile::tempdir().unwrap();
        let occupied = root.path().join("abcdefgh");
        std::fs::create_dir(&occupied).unwrap();
        std::fs::write(occupied.join("keep"), "existing").unwrap();
        let mut names = ["abcdefgh", "ijklmnop"].into_iter();
        let reserved = reserve_in(root.path(), || names.next().unwrap().into()).unwrap();
        assert_eq!(reserved.path(), root.path().join("ijklmnop"));
        assert_eq!(
            std::fs::read_to_string(occupied.join("keep")).unwrap(),
            "existing"
        );
        drop(reserved);
        assert!(!root.path().join("ijklmnop").exists());
        assert_eq!(
            reserve_in(root.path(), || "abcdefgh".into())
                .err()
                .unwrap()
                .kind(),
            io::ErrorKind::AlreadyExists
        );
        let reserved = reserve_in(root.path(), || "qrstuvwx".into()).unwrap();
        std::fs::create_dir(reserved.path().join("repo")).unwrap();
        drop(reserved);
        assert!(root.path().join("qrstuvwx/repo").exists());
    }
}
