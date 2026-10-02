use std::{
    io,
    path::{Path, PathBuf},
};

use crate::{error::Result, model::Directory, settings::SettingsStore};

use super::git_routes::choose_shared_branch;

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
    let mut name = String::with_capacity(4);
    while name.len() < 4 {
        for byte in uuid::Uuid::new_v4().as_bytes().iter().take(6) {
            // Rejection sampling avoids modulo bias for the 26-letter alphabet.
            if *byte < 234 {
                name.push((b'a' + byte % 26) as char);
                if name.len() == 4 {
                    break;
                }
            }
        }
    }
    name
}

pub(super) fn reserve_shared_worktree(
    settings: &SettingsStore,
    locations: &[Directory],
    explicit: Option<&str>,
    generated: Option<&str>,
    reuse_existing: bool,
) -> Result<(String, WorktreeRoot)> {
    let root = settings.treefold_home().join("git/w");
    std::fs::create_dir_all(&root).map_err(anyhow::Error::from)?;
    for attempt in 0..32 {
        let branch = choose_shared_branch(
            locations,
            explicit,
            generated.filter(|_| attempt == 0),
            reuse_existing,
        )?;
        if explicit.is_some() {
            return Ok((branch, reserve_worktree_root(settings)?));
        }
        let name = branch.rsplit('/').next().unwrap_or_default();
        if name.is_empty() || name == "." || name == ".." {
            return Err(crate::error::AppError::BadRequest(
                "invalid Workspace branch name".into(),
            ));
        }
        let path = root.join(name);
        match std::fs::create_dir(&path) {
            Ok(()) => return Ok((branch, WorktreeRoot(path))),
            // A directory conflict must regenerate the branch and directory together.
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(anyhow::Error::from(error).into()),
        }
    }
    Err(anyhow::anyhow!("could not allocate a shared worktree directory and branch").into())
}

fn reserve_worktree_root(settings: &SettingsStore) -> Result<WorktreeRoot> {
    reserve_in(&settings.treefold_home().join("git/w"), || {
        format!(
            "{}-{}",
            chrono::Local::now().format("%y%m%d-%H%M"),
            random_name()
        )
    })
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
    fn automatic_branches_share_the_reserved_directory_name() {
        let root = tempfile::tempdir().unwrap();
        let settings = SettingsStore::open(root.path()).unwrap();
        let preview = "treefold/261002-1234-abcd";
        let (branch, reserved) =
            reserve_shared_worktree(&settings, &[], None, Some(preview), false).unwrap();
        assert_eq!(branch, preview);
        assert_eq!(reserved.path().file_name().unwrap(), "261002-1234-abcd");
        std::fs::write(reserved.path().join("keep"), "existing").unwrap();

        // Even without a Git branch conflict, an occupied directory replaces both names.
        let (retried_branch, retried_root) =
            reserve_shared_worktree(&settings, &[], None, Some(preview), false).unwrap();
        assert_ne!(retried_branch, preview);
        assert_eq!(
            retried_root.path().file_name().unwrap().to_str().unwrap(),
            retried_branch.strip_prefix("treefold/").unwrap()
        );
        assert_eq!(
            std::fs::read_to_string(reserved.path().join("keep")).unwrap(),
            "existing"
        );

        let (branch, reserved) = reserve_shared_worktree(&settings, &[], None, None, true).unwrap();
        assert_eq!(
            reserved.path().file_name().unwrap().to_str().unwrap(),
            branch.strip_prefix("treefold/").unwrap()
        );
    }

    #[test]
    fn worktree_names_are_four_lowercase_letters() {
        for _ in 0..100 {
            let name = random_name();
            assert_eq!(name.len(), 4);
            assert!(name.bytes().all(|byte| byte.is_ascii_lowercase()));
        }
    }

    #[test]
    fn worktree_names_retry_conflicts_and_preserve_existing_contents() {
        let root = tempfile::tempdir().unwrap();
        let occupied = root.path().join("abcd");
        std::fs::create_dir(&occupied).unwrap();
        std::fs::write(occupied.join("keep"), "existing").unwrap();
        let mut names = ["abcd", "efgh"].into_iter();
        let reserved = reserve_in(root.path(), || names.next().unwrap().into()).unwrap();
        assert_eq!(reserved.path(), root.path().join("efgh"));
        assert_eq!(
            std::fs::read_to_string(occupied.join("keep")).unwrap(),
            "existing"
        );
        drop(reserved);
        assert!(!root.path().join("efgh").exists());
        assert_eq!(
            reserve_in(root.path(), || "abcd".into())
                .err()
                .unwrap()
                .kind(),
            io::ErrorKind::AlreadyExists
        );
        let reserved = reserve_in(root.path(), || "ijkl".into()).unwrap();
        std::fs::create_dir(reserved.path().join("repo")).unwrap();
        drop(reserved);
        assert!(root.path().join("ijkl/repo").exists());
    }
}
