use std::{path::Path, process::Command};

use super::{
    delivery::{git_head, git_is_ancestor},
    git_routes::{ParsedGitWorktree, command_output, current_project_branch, normalized_path},
};
use crate::model::{GitWorktreeStatus, ParentOperation, WorktreeComparison};

pub(super) struct ComparisonTarget {
    branch: String,
    head: String,
}

pub(super) fn comparison_target(path: &str) -> Option<ComparisonTarget> {
    Some(ComparisonTarget {
        branch: current_project_branch(path).ok()?,
        head: git_head(path).ok()?,
    })
}

pub(super) fn inspect_worktree_status(
    project_path: &str,
    worktree: &ParsedGitWorktree,
    target: Option<&ComparisonTarget>,
    squash_operations: &[ParentOperation],
) -> GitWorktreeStatus {
    let mut result = GitWorktreeStatus {
        prunable_reason: worktree.prunable_reason.clone(),
        locked_reason: worktree.locked_reason.clone(),
        detached: worktree.detached,
        available: false,
        dirty: false,
        conflicted: false,
        comparison: WorktreeComparison::Unknown,
        target_branch: target.map(|target| target.branch.clone()),
        ahead: None,
        behind: None,
        has_ignored_files: false,
        operation_in_progress: false,
        cleanup_candidate: false,
    };
    // Do not let Git fall back to an unrelated ancestor repository.
    let path = Path::new(&worktree.path);
    if path.is_dir() && path.join(".git").exists() {
        if let Ok(output) = Command::new("git")
            .current_dir(path)
            .args([
                "--no-optional-locks",
                "status",
                "--porcelain=v1",
                "-z",
                "--untracked-files=normal",
                "--ignored=matching",
                "--ignore-submodules=none",
            ])
            .output()
            && output.status.success()
        {
            result.available = true;
            let mut records = output.stdout.split(|byte| *byte == 0);
            while let Some(record) = records.next() {
                if record.len() < 3 {
                    continue;
                }
                let xy = &record[..2];
                if xy == b"!!" {
                    result.has_ignored_files = true;
                    continue;
                }
                result.dirty = true;
                result.conflicted |=
                    matches!(xy, b"DD" | b"AU" | b"UD" | b"UA" | b"DU" | b"AA" | b"UU");
                if xy.contains(&b'R') || xy.contains(&b'C') {
                    records.next();
                }
            }
        }
    }
    let operation_state_known = command_output(path, "git", &["rev-parse", "--absolute-git-dir"])
        .map(|directory| {
            result.operation_in_progress = [
                "rebase-merge",
                "rebase-apply",
                "MERGE_HEAD",
                "CHERRY_PICK_HEAD",
                "REVERT_HEAD",
                "sequencer",
                "BISECT_START",
            ]
            .iter()
            .any(|marker| Path::new(&directory).join(marker).exists());
        })
        .is_ok();
    if normalized_path(project_path) == normalized_path(&worktree.path) {
        result.comparison = WorktreeComparison::NotApplicable;
        return result;
    }
    let Some(target) = target.filter(|_| result.available) else {
        return result;
    };
    let counts = command_output(
        Path::new(project_path),
        "git",
        &[
            "rev-list",
            "--left-right",
            "--count",
            &format!("{}...{}", worktree.head_commit, target.head),
            "--",
        ],
    )
    .ok()
    .and_then(|output| {
        let mut counts = output.split_whitespace();
        Some((
            counts.next()?.parse::<u64>().ok()?,
            counts.next()?.parse::<u64>().ok()?,
        ))
    });
    if let Some((ahead, behind)) = counts {
        result.ahead = Some(ahead);
        result.behind = Some(behind);
        result.comparison = match (ahead, behind) {
            (0, 0) => WorktreeComparison::Same,
            (0, _) => WorktreeComparison::Contained,
            _ => WorktreeComparison::Uncontained,
        };
        if ahead > 0 {
            // Only trust a completed operation for these exact source and target commits.
            for operation in squash_operations {
                if operation.strategy == "squash"
                    && operation.status == "completed"
                    && operation.direction == "integrate"
                    && operation.source_head == worktree.head_commit
                    && normalized_path(&operation.source_path) == normalized_path(&worktree.path)
                    && normalized_path(&operation.target_path) == normalized_path(project_path)
                    && operation.target_branch == target.branch
                    && operation.result_head.as_deref().is_some_and(|head| {
                        git_is_ancestor(project_path, head, &target.head).unwrap_or(false)
                    })
                {
                    result.comparison = WorktreeComparison::Squashed;
                    break;
                }
            }
        }
    }
    result.cleanup_candidate = matches!(result.comparison,
        WorktreeComparison::Same | WorktreeComparison::Contained | WorktreeComparison::Squashed)
        && !worktree.is_main && !result.dirty && !result.has_ignored_files
        && result.locked_reason.is_none() && result.prunable_reason.is_none()
        && operation_state_known && !result.operation_in_progress
        && !path.join(".gitmodules").exists()
        // A detached squash source can still carry otherwise unreachable original commits.
        && !(result.detached && result.comparison == WorktreeComparison::Squashed);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::server::git_routes::{command_output, git_worktrees};

    fn git(path: &Path, args: &[&str]) -> String {
        command_output(path, "git", args).unwrap()
    }

    fn repository(root: &Path) -> std::path::PathBuf {
        let path = root.join("repo");
        std::fs::create_dir(&path).unwrap();
        git(&path, &["init", "-b", "main"]);
        git(&path, &["config", "user.name", "Treefold Test"]);
        git(&path, &["config", "user.email", "treefold@example.test"]);
        std::fs::write(path.join("file.txt"), "base\n").unwrap();
        git(&path, &["add", "."]);
        git(&path, &["commit", "-m", "base"]);
        path
    }

    fn inspect(repo: &Path, checkout: &Path, operations: &[ParentOperation]) -> GitWorktreeStatus {
        let repo = repo.to_str().unwrap();
        let item = git_worktrees(repo)
            .unwrap()
            .into_iter()
            .find(|item| normalized_path(&item.path) == normalized_path(checkout.to_str().unwrap()))
            .unwrap();
        inspect_worktree_status(repo, &item, comparison_target(repo).as_ref(), operations)
    }

    #[test]
    fn worktree_status_tracks_current_target_dirty_locked_detached_and_prunable() {
        let temp = tempfile::tempdir().unwrap();
        let repo = repository(temp.path());
        // Null-delimited porcelain must preserve spaces, Unicode, and newlines.
        let checkout = temp.path().join("feature 工作树\ncheckout");
        git(
            &repo,
            &[
                "worktree",
                "add",
                "-b",
                "feature",
                checkout.to_str().unwrap(),
            ],
        );
        let status = inspect(&repo, &checkout, &[]);
        assert_eq!(status.comparison, WorktreeComparison::Same);
        assert_eq!((status.ahead, status.behind), (Some(0), Some(0)));
        assert!(status.cleanup_candidate);
        assert_eq!(status.target_branch.as_deref(), Some("main"));
        assert!(status.available && !status.dirty);
        assert_eq!(
            inspect(&repo, &repo, &[]).comparison,
            WorktreeComparison::NotApplicable
        );

        std::fs::write(checkout.join("untracked.txt"), "keep\n").unwrap();
        assert!(inspect(&repo, &checkout, &[]).dirty);
        assert!(!inspect(&repo, &checkout, &[]).cleanup_candidate);
        git(&checkout, &["add", "."]);
        assert!(inspect(&repo, &checkout, &[]).dirty);
        git(&checkout, &["commit", "-m", "feature"]);
        assert_eq!(
            inspect(&repo, &checkout, &[]).comparison,
            WorktreeComparison::Uncontained
        );
        let status = inspect(&repo, &checkout, &[]);
        assert_eq!((status.ahead, status.behind), (Some(1), Some(0)));
        assert!(!status.cleanup_candidate);
        git(&repo, &["merge", "--ff-only", "feature"]);
        git(&repo, &["commit", "--allow-empty", "-m", "target advances"]);
        assert_eq!(
            inspect(&repo, &checkout, &[]).comparison,
            WorktreeComparison::Contained
        );
        let status = inspect(&repo, &checkout, &[]);
        assert_eq!((status.ahead, status.behind), (Some(0), Some(1)));
        assert!(status.cleanup_candidate);
        std::fs::write(checkout.join("file.txt"), "dirty\n").unwrap();
        let status = inspect(&repo, &checkout, &[]);
        assert!(status.dirty);
        assert_eq!(status.comparison, WorktreeComparison::Contained);

        git(&repo, &["switch", "-c", "other", "main~2"]);
        let status = inspect(&repo, &checkout, &[]);
        assert_eq!(status.target_branch.as_deref(), Some("other"));
        assert_eq!(status.comparison, WorktreeComparison::Uncontained);
        git(&repo, &["checkout", "--detach"]);
        let status = inspect(&repo, &checkout, &[]);
        assert_eq!(status.comparison, WorktreeComparison::Unknown);
        assert_eq!(status.target_branch, None);
        assert_eq!((status.ahead, status.behind), (None, None));
        assert!(!status.cleanup_candidate);
        git(&repo, &["switch", "main"]);
        git(&checkout, &["checkout", "--detach"]);
        assert!(inspect(&repo, &checkout, &[]).detached);
        git(
            &repo,
            &[
                "worktree",
                "lock",
                "--reason",
                "external disk",
                checkout.to_str().unwrap(),
            ],
        );
        assert_eq!(
            inspect(&repo, &checkout, &[]).locked_reason.as_deref(),
            Some("external disk")
        );
        git(&repo, &["worktree", "unlock", checkout.to_str().unwrap()]);
        std::fs::remove_dir_all(&checkout).unwrap();
        let status = inspect(&repo, &checkout, &[]);
        assert!(!status.available);
        assert!(status.prunable_reason.is_some());
        assert_eq!(status.comparison, WorktreeComparison::Unknown);
    }

    #[test]
    fn worktree_cleanup_candidate_checks_ignored_files_locks_and_clean_operations() {
        let temp = tempfile::tempdir().unwrap();
        let repo = repository(temp.path());
        let checkout = temp.path().join("feature");
        git(
            &repo,
            &[
                "worktree",
                "add",
                "-b",
                "feature",
                checkout.to_str().unwrap(),
            ],
        );
        assert!(inspect(&repo, &checkout, &[]).cleanup_candidate);
        std::fs::write(repo.join(".git/info/exclude"), "local-secret\n").unwrap();
        std::fs::write(checkout.join("local-secret"), "keep").unwrap();
        let status = inspect(&repo, &checkout, &[]);
        assert!(status.has_ignored_files && !status.dirty && !status.cleanup_candidate);
        std::fs::remove_file(checkout.join("local-secret")).unwrap();
        git(&repo, &["worktree", "lock", checkout.to_str().unwrap()]);
        assert!(!inspect(&repo, &checkout, &[]).cleanup_candidate);
        git(&repo, &["worktree", "unlock", checkout.to_str().unwrap()]);
        let git_dir = git(&checkout, &["rev-parse", "--absolute-git-dir"]);
        let marker = Path::new(&git_dir).join("BISECT_START");
        std::fs::write(&marker, "feature\n").unwrap();
        let status = inspect(&repo, &checkout, &[]);
        assert!(status.operation_in_progress && !status.dirty && !status.cleanup_candidate);
        std::fs::remove_file(marker).unwrap();
        assert!(inspect(&repo, &checkout, &[]).cleanup_candidate);
        assert!(!inspect(&repo, &repo, &[]).cleanup_candidate);
    }

    #[test]
    fn worktree_status_reports_conflicts() {
        let temp = tempfile::tempdir().unwrap();
        let repo = repository(temp.path());
        let checkout = temp.path().join("feature");
        git(
            &repo,
            &[
                "worktree",
                "add",
                "-b",
                "feature",
                checkout.to_str().unwrap(),
            ],
        );
        for (path, contents) in [(&repo, "main\n"), (&checkout, "feature\n")] {
            std::fs::write(path.join("file.txt"), contents).unwrap();
            git(path, &["commit", "-am", "change"]);
        }
        assert!(command_output(&checkout, "git", &["merge", "main"]).is_err());
        let status = inspect(&repo, &checkout, &[]);
        assert!(status.available && status.dirty && status.conflicted);
        assert_eq!((status.ahead, status.behind), (Some(1), Some(1)));
        assert!(status.operation_in_progress);
        assert!(!status.cleanup_candidate);
    }

    #[test]
    fn worktree_status_squash_requires_matching_record_and_current_commits() {
        let temp = tempfile::tempdir().unwrap();
        let repo = repository(temp.path());
        let checkout = temp.path().join("feature");
        git(
            &repo,
            &[
                "worktree",
                "add",
                "-b",
                "feature",
                checkout.to_str().unwrap(),
            ],
        );
        std::fs::write(checkout.join("file.txt"), "feature\n").unwrap();
        git(&checkout, &["commit", "-am", "feature"]);
        git(&repo, &["merge", "--squash", "feature"]);
        git(&repo, &["commit", "-m", "squashed"]);
        let mut operation: ParentOperation = serde_json::from_value(serde_json::json!({
            "id": "operation", "workspace_repository_id": "repository", "workspace_id": "workspace",
            "direction": "integrate", "strategy": "squash", "origin": "finish",
            "source_repository_id": "repository", "source_path": checkout,
            "source_branch": "feature", "source_head": git(&checkout, &["rev-parse", "HEAD"]),
            "target_scope": "project", "target_workspace_id": null, "target_path": repo,
            "target_branch": "main", "parent_head": "", "before_head": "",
            "result_head": git(&repo, &["rev-parse", "HEAD"]), "recovery_ref": "",
            "status": "completed", "phase": "completed", "error": "",
            "started_at": "", "updated_at": "", "completed_at": ""
        }))
        .unwrap();
        assert_eq!(
            inspect(&repo, &checkout, &[]).comparison,
            WorktreeComparison::Uncontained
        );
        assert_eq!(
            inspect(&repo, &checkout, &[operation.clone()]).comparison,
            WorktreeComparison::Squashed
        );
        let status = inspect(&repo, &checkout, &[operation.clone()]);
        assert_eq!((status.ahead, status.behind), (Some(1), Some(1)));
        assert!(status.cleanup_candidate);
        operation.target_branch = "other".into();
        assert_eq!(
            inspect(&repo, &checkout, &[operation.clone()]).comparison,
            WorktreeComparison::Uncontained
        );
        operation.target_branch = "main".into();
        git(&checkout, &["commit", "--allow-empty", "-m", "new work"]);
        assert_eq!(
            inspect(&repo, &checkout, &[operation]).comparison,
            WorktreeComparison::Uncontained
        );
    }
}
