use super::service::*;
use std::path::Path;
struct Repo {
    _dir: tempfile::TempDir,
    path: String,
}
impl Repo {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_str().unwrap().to_owned();
        for args in [
            vec!["init", "-b", "main"],
            vec!["config", "user.name", "Test"],
            vec!["config", "user.email", "test@example.test"],
            vec!["config", "commit.gpgsign", "false"],
        ] {
            output(&path, &args).unwrap();
        }
        std::fs::write(Path::new(&path).join("file"), "initial").unwrap();
        output(&path, &["add", "."]).unwrap();
        output(&path, &["commit", "-m", "Original\n\nFull body"]).unwrap();
        Self { _dir: dir, path }
    }
    fn git(&self, args: &[&str]) -> String {
        output(&self.path, args).unwrap()
    }
    fn head(&self) -> String {
        self.git(&["rev-parse", "HEAD"])
    }
}
#[test]
fn reword_preserves_tree_author_index_and_worktree_with_root_commit() {
    let r = Repo::new();
    let before = r.head();
    let metadata = r.git(&["show", "-s", "--format=%T %P %an %ae %aI", "HEAD"]);
    std::fs::write(Path::new(&r.path).join("file"), "staged").unwrap();
    r.git(&["add", "file"]);
    std::fs::write(Path::new(&r.path).join("file"), "unstaged").unwrap();
    std::fs::write(Path::new(&r.path).join("untracked"), "untracked").unwrap();
    let index = r.git(&["ls-files", "--stage"]);
    let status = r.git(&["status", "--porcelain"]);
    assert_eq!(
        preview(&r.path, &before).unwrap().message,
        "Original\n\nFull body\n"
    );
    let after = apply(
        &r.path,
        &before,
        "refs/heads/main",
        "New title\n\nNew body",
        &[],
    )
    .unwrap();
    assert_ne!(before, after);
    assert_eq!(
        r.git(&["show", "-s", "--format=%T %P %an %ae %aI", "HEAD"]),
        metadata
    );
    assert_eq!(r.git(&["ls-files", "--stage"]), index);
    assert_eq!(r.git(&["status", "--porcelain"]), status);
    assert_eq!(
        std::fs::read_to_string(Path::new(&r.path).join("file")).unwrap(),
        "unstaged"
    );
    assert_eq!(
        r.git(&["show", "-s", "--format=%B", "HEAD"]),
        "New title\n\nNew body"
    );
    assert_eq!(r.git(&["rev-parse", "main@{1}"]), before);
}
#[test]
fn reword_merge_preserves_all_parents() {
    let r = Repo::new();
    r.git(&["checkout", "-b", "feature"]);
    r.git(&["commit", "--allow-empty", "-m", "feature"]);
    r.git(&["checkout", "main"]);
    r.git(&["merge", "--no-ff", "feature", "-m", "Merge feature"]);
    let parents = r.git(&["show", "-s", "--format=%P", "HEAD"]);
    assert_eq!(parents.split_whitespace().count(), 2);
    apply(&r.path, &r.head(), "refs/heads/main", "Reworded merge", &[]).unwrap();
    assert_eq!(r.git(&["show", "-s", "--format=%P", "HEAD"]), parents);
}
#[test]
fn reword_shared_refs_require_confirmation_without_network() {
    let r = Repo::new();
    let head = r.head();
    // No usable remote: a successful edit must use only local ref information.
    r.git(&[
        "remote",
        "add",
        "origin",
        "/nonexistent/treefold-test-remote",
    ]);
    r.git(&["update-ref", "refs/remotes/origin/main", &head]);
    r.git(&["tag", "v1"]);
    r.git(&["branch", "other"]);
    let preview = preview(&r.path, &head).unwrap();
    assert_eq!(preview.shared_refs.len(), 3);
    assert!(apply(&r.path, &head, &preview.branch, "New", &[]).is_err());
    assert_eq!(r.head(), head);
    apply(&r.path, &head, &preview.branch, "New", &preview.shared_refs).unwrap();
    for reference in &preview.shared_refs {
        assert_eq!(r.git(&["rev-parse", reference]), head);
    }
}
#[test]
fn reword_rejects_stale_branch_head_operations_and_delivery_marker() {
    let r = Repo::new();
    let head = r.head();
    assert!(apply(&r.path, &head, "refs/heads/other", "New", &[]).is_err());
    assert!(apply(&r.path, &head, "refs/heads/main", "  ", &[]).is_err());
    assert!(
        apply(
            &r.path,
            &head,
            "refs/heads/main",
            "Fake\n\nTreefold-Squash: fake",
            &[]
        )
        .is_err()
    );
    r.git(&["commit", "--allow-empty", "-m", "Next"]);
    assert!(preview(&r.path, &head).is_err());
    let head = r.head();
    let gitdir = r.git(&["rev-parse", "--absolute-git-dir"]);
    std::fs::write(Path::new(&gitdir).join("MERGE_HEAD"), &head).unwrap();
    assert!(preview(&r.path, &head).is_err());
    std::fs::remove_file(Path::new(&gitdir).join("MERGE_HEAD")).unwrap();
    r.git(&[
        "commit",
        "--allow-empty",
        "-m",
        "Squash feature\n\nTreefold-Squash: operation",
    ]);
    assert!(preview(&r.path, &r.head()).is_err());
}
#[test]
fn reword_signing_failure_keeps_original_head() {
    let r = Repo::new();
    let head = r.head();
    r.git(&["config", "commit.gpgsign", "true"]);
    r.git(&["config", "gpg.program", "/usr/bin/false"]);
    assert!(apply(&r.path, &head, "refs/heads/main", "Signed", &[]).is_err());
    assert_eq!(r.head(), head);
}
