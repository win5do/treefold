use super::*;
struct Repo {
    _dir: tempfile::TempDir,
    path: String,
    commits: Vec<String>,
}
impl Repo {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_string_lossy().into_owned();
        output(&path, &["init", "-b", "main"]).unwrap();
        output(&path, &["config", "user.name", "Test"]).unwrap();
        output(&path, &["config", "user.email", "test@example.test"]).unwrap();
        output(&path, &["config", "commit.gpgsign", "false"]).unwrap();
        let mut repo = Self {
            _dir: dir,
            path,
            commits: Vec::new(),
        };
        for i in 0..6 {
            repo.commit(&i.to_string());
        }
        repo
    }
    fn commit(&mut self, content: &str) {
        std::fs::write(Path::new(&self.path).join("file"), content).unwrap();
        output(&self.path, &["add", "file"]).unwrap();
        output(&self.path, &["commit", "--allow-empty", "-m", content]).unwrap();
        self.commits.push(git_head(&self.path).unwrap());
    }
    fn head(&self) -> String {
        git_head(&self.path).unwrap()
    }
}
#[test]
fn squash_middle_preserves_every_tree_and_empty_commit_and_undo() {
    let mut r = Repo::new();
    r.commit("5"); // intentionally empty suffix commit
    let before = r.head();
    let preview = plan(
        &r.path,
        Some(&r.commits[0]),
        None,
        &r.commits[1..3],
        &before,
    )
    .unwrap();
    assert_eq!(preview.preview.replayed_count, 4);
    let id = apply(
        &r.path,
        Some(&r.commits[0]),
        None,
        &r.commits[1..3],
        &before,
        "combined",
    )
    .unwrap();
    let after = r.head();
    let rewritten = output(&r.path, &["rev-list", "--reverse", "HEAD"]).unwrap();
    let rewritten: Vec<_> = rewritten.lines().collect();
    assert_eq!(rewritten.len(), 6);
    for (old, new) in r.commits[2..].iter().zip(&rewritten[1..]) {
        assert_eq!(tree(&r.path, old).unwrap(), tree(&r.path, new).unwrap());
    }
    assert!(
        output(&r.path, &["status", "--porcelain"])
            .unwrap()
            .is_empty()
    );
    undo(&r.path, &id, &after, None).unwrap();
    assert_eq!(r.head(), before);
}
#[test]
fn squash_tip_and_stale_undo() {
    let mut r = Repo::new();
    let id = apply(&r.path, None, None, &r.commits[4..], &r.head(), "tip").unwrap();
    let after = r.head();
    r.commit("later");
    assert!(undo(&r.path, &id, &after, None).is_err());
    assert!(undo(&r.path, &id, &r.head(), None).is_err());
}
#[test]
fn squash_rejects_dirty_stale_noncontiguous_boundary_published_tagged_and_delivered() {
    let r = Repo::new();
    let selected = &r.commits[2..4];
    assert!(plan(&r.path, None, None, selected, &r.commits[4]).is_err());
    assert!(
        plan(
            &r.path,
            None,
            None,
            &[r.commits[2].clone(), r.commits[4].clone()],
            &r.head()
        )
        .is_err()
    );
    assert!(plan(&r.path, Some(&r.commits[2]), None, selected, &r.head()).is_err());
    assert!(plan(&r.path, None, Some(&r.commits[3]), selected, &r.head()).is_err());
    std::fs::write(Path::new(&r.path).join("untracked"), "x").unwrap();
    assert!(plan(&r.path, None, None, selected, &r.head()).is_err());
    std::fs::remove_file(Path::new(&r.path).join("untracked")).unwrap();
    for reference in ["refs/remotes/origin/topic", "refs/tags/release"] {
        output(&r.path, &["update-ref", reference, &r.commits[4]]).unwrap();
        assert!(plan(&r.path, None, None, selected, &r.head()).is_err());
        output(&r.path, &["update-ref", "-d", reference]).unwrap();
    }
    output(&r.path, &["branch", "shared", &r.commits[4]]).unwrap();
    assert_eq!(
        plan(&r.path, None, None, selected, &r.head())
            .unwrap()
            .preview
            .shared_branches,
        vec!["shared"]
    );
}
#[test]
fn squash_blocks_merge_in_selection_or_suffix_but_allows_earlier_merge() {
    let mut r = Repo::new();
    output(&r.path, &["checkout", "-b", "side", &r.commits[1]]).unwrap();
    std::fs::write(Path::new(&r.path).join("side"), "side").unwrap();
    output(&r.path, &["add", "side"]).unwrap();
    output(&r.path, &["commit", "-m", "side"]).unwrap();
    let side = r.head();
    output(&r.path, &["checkout", "main"]).unwrap();
    output(&r.path, &["merge", "--no-ff", "side", "-m", "merge"]).unwrap();
    let merge = r.head();
    assert!(plan(&r.path, None, None, &r.commits[2..4], &merge).is_err());
    assert!(
        plan(
            &r.path,
            None,
            None,
            &[r.commits[5].clone(), merge.clone()],
            &merge
        )
        .is_err()
    );
    assert!(plan(&r.path, None, None, &[side, merge.clone()], &merge).is_err());
    r.commit("after 1");
    r.commit("after 2");
    apply(
        &r.path,
        None,
        None,
        &r.commits[6..],
        &r.head(),
        "after merge",
    )
    .unwrap();
    assert_eq!(output(&r.path, &["rev-parse", "HEAD^"]).unwrap(), merge);
}
#[test]
fn squash_recovery_is_bound_to_branch_and_rejects_published_undo() {
    let r = Repo::new();
    let id = apply(&r.path, None, None, &r.commits[2..4], &r.head(), "squash").unwrap();
    output(&r.path, &["checkout", "-b", "other"]).unwrap();
    assert!(undo(&r.path, &id, &r.head(), None).is_err());
    output(&r.path, &["checkout", "main"]).unwrap();
    output(&r.path, &["update-ref", "refs/remotes/origin/main", "HEAD"]).unwrap();
    assert!(undo(&r.path, &id, &r.head(), None).is_err());
}
