use super::*;
use crate::server::workspace_delete::{DeleteWorkspaceOptions, delete_precheck, delete_workspace};
use axum::extract::Query;

async fn finish_retained(f: &Fixture) {
    let mut plan = plans(f).await;
    for item in &mut plan {
        item.delete_worktree = false;
        item.delete_branch = false;
    }
    let batch = prepare_batch(&f.state, &f.workspace.id, plan)
        .await
        .unwrap();
    run_batch(&f.state, batch, false).await.unwrap();
    assert_eq!(saved(f).await.status, "completed");
}

#[tokio::test]
async fn deletion_respects_separate_checkout_and_branch_choices() {
    for (delete_worktrees, delete_branches) in [(false, false), (true, false), (true, true)] {
        let f = fixture().await;
        finish_retained(&f).await;
        let status = delete_workspace(
            State(f.state.clone()),
            AxumPath(f.workspace.id.clone()),
            Query(DeleteWorkspaceOptions {
                delete_worktrees,
                delete_branches,
                ..Default::default()
            }),
        )
        .await
        .unwrap();
        assert_eq!(status, StatusCode::NO_CONTENT);
        assert!(f.state.store.workspace(&f.workspace.id).await.is_err());
        for location in &f.repositories {
            assert_eq!(
                Path::new(location.checkout_path.as_ref().unwrap()).exists(),
                !delete_worktrees
            );
            let branches = git(
                Path::new(&location.source_root),
                &["branch", "--list", location.branch.as_ref().unwrap()],
            );
            assert_eq!(!branches.is_empty(), !delete_branches);
        }
    }
}

#[tokio::test]
async fn deletion_validates_all_checkouts_and_preserves_undelivered_commits() {
    let f = fixture().await;
    finish_retained(&f).await;
    let last = Path::new(f.repositories[1].checkout_path.as_ref().unwrap());
    std::fs::write(last.join("late.txt"), "uncommitted").unwrap();
    let cleanup = DeleteWorkspaceOptions {
        delete_worktrees: true,
        delete_branches: true,
        ..Default::default()
    };
    assert!(
        delete_workspace(
            State(f.state.clone()),
            AxumPath(f.workspace.id.clone()),
            Query(cleanup.clone())
        )
        .await
        .is_err()
    );
    assert!(
        f.repositories
            .iter()
            .all(|r| Path::new(r.checkout_path.as_ref().unwrap()).exists())
    );
    commit(last, "late.txt", "new committed work");
    assert!(
        delete_workspace(
            State(f.state.clone()),
            AxumPath(f.workspace.id.clone()),
            Query(cleanup.clone())
        )
        .await
        .is_err()
    );
    assert!(f.state.store.workspace(&f.workspace.id).await.is_ok());
    assert!(
        f.repositories
            .iter()
            .all(|r| Path::new(r.checkout_path.as_ref().unwrap()).exists())
    );
    // Retaining branches preserves committed work even when its checkout is removed.
    delete_workspace(
        State(f.state.clone()),
        AxumPath(f.workspace.id.clone()),
        Query(DeleteWorkspaceOptions {
            delete_worktrees: true,
            delete_branches: false,
            ..Default::default()
        }),
    )
    .await
    .unwrap();
    let location = &f.repositories[1];
    assert_eq!(
        git(
            Path::new(&location.source_root),
            &[
                "show",
                &format!("{}:late.txt", location.branch.as_ref().unwrap())
            ]
        ),
        "new committed work"
    );
}

#[tokio::test]
async fn deletion_preserves_user_branches_and_rejects_active_workspaces() {
    let f = fixture().await;
    let cleanup = DeleteWorkspaceOptions {
        delete_worktrees: true,
        delete_branches: true,
        ..Default::default()
    };
    assert!(
        delete_workspace(
            State(f.state.clone()),
            AxumPath(f.workspace.id.clone()),
            Query(cleanup.clone())
        )
        .await
        .is_err()
    );
    sqlx::query("UPDATE workspace_repositories SET branch_ownership='user' WHERE workspace_id=?")
        .bind(&f.workspace.id)
        .execute(&f.state.store.pool)
        .await
        .unwrap();
    finish_retained(&f).await;
    delete_workspace(
        State(f.state.clone()),
        AxumPath(f.workspace.id.clone()),
        Query(cleanup.clone()),
    )
    .await
    .unwrap();
    for location in &f.repositories {
        assert!(!Path::new(location.checkout_path.as_ref().unwrap()).exists());
        assert!(
            !git(
                Path::new(&location.source_root),
                &["branch", "--list", location.branch.as_ref().unwrap()]
            )
            .is_empty()
        );
    }
}

#[tokio::test]
async fn deletion_cleans_archived_forks_with_their_parent() {
    let mut f = fixture().await;
    let parent = f.workspace.clone();
    let parent_repositories = f.repositories.clone();
    f.workspace = crate::server::fork::create_fork_impl(
        f.state.clone(),
        parent.id.clone(),
        crate::server::fork::CreateFork {
            description: None,
            branch: Some("task/delete".into()),
            generated_branch: None,
        },
    )
    .await
    .unwrap()
    .workspace;
    f.repositories = f
        .state
        .store
        .workspace_repositories(&f.workspace.id)
        .await
        .unwrap();
    let fork_id = f.workspace.id.clone();
    let fork_paths: Vec<_> = f
        .repositories
        .iter()
        .map(|r| r.checkout_path.clone().unwrap())
        .collect();
    finish_retained(&f).await;
    f.workspace = parent;
    f.repositories = parent_repositories;
    finish_retained(&f).await;
    delete_workspace(
        State(f.state.clone()),
        AxumPath(f.workspace.id.clone()),
        Query(DeleteWorkspaceOptions {
            delete_worktrees: true,
            delete_branches: true,
            ..Default::default()
        }),
    )
    .await
    .unwrap();
    assert!(f.state.store.workspace(&fork_id).await.is_err());
    assert!(fork_paths.iter().all(|p| !Path::new(p).exists()));
    assert!(
        f.repositories
            .iter()
            .all(|r| !Path::new(r.checkout_path.as_ref().unwrap()).exists())
    );
}

#[tokio::test]
async fn deletion_cleans_verified_squash_without_requiring_source_ancestry() {
    let f = fixture().await;
    let mut plan = plans(&f).await;
    for item in &mut plan {
        let (_, Json(preflight)) = create_workspace_repository_preflight_impl(
            f.state.clone(),
            item.repository_id.clone(),
            CreateDeliveryPreflight {
                code_action: "squash_merge".into(),
            },
        )
        .await
        .unwrap();
        item.code_action = "squash_merge".into();
        item.preflight_id = preflight.id;
        item.delete_worktree = false;
        item.delete_branch = false;
    }
    run_batch(
        &f.state,
        prepare_batch(&f.state, &f.workspace.id, plan)
            .await
            .unwrap(),
        false,
    )
    .await
    .unwrap();
    assert_eq!(saved(&f).await.status, "completed");
    delete_workspace(
        State(f.state.clone()),
        AxumPath(f.workspace.id.clone()),
        Query(DeleteWorkspaceOptions {
            delete_worktrees: true,
            delete_branches: true,
            ..Default::default()
        }),
    )
    .await
    .unwrap();
    for location in &f.repositories {
        assert!(!Path::new(location.checkout_path.as_ref().unwrap()).exists());
        assert!(
            git(
                Path::new(&location.source_root),
                &["branch", "--list", location.branch.as_ref().unwrap()]
            )
            .is_empty()
        );
    }
}

fn cleanup_options() -> DeleteWorkspaceOptions {
    DeleteWorkspaceOptions {
        delete_worktrees: true,
        delete_branches: true,
        ..Default::default()
    }
}

async fn deletion_preview(f: &Fixture) -> crate::model::WorkspaceDeletePrecheck {
    delete_precheck(
        State(f.state.clone()),
        AxumPath(f.workspace.id.clone()),
        Query(cleanup_options()),
    )
    .await
    .unwrap()
    .0
}

fn assert_checkouts_preserved(f: &Fixture) {
    for location in &f.repositories {
        assert!(Path::new(location.checkout_path.as_ref().unwrap()).exists());
        assert!(
            !git(
                Path::new(&location.source_root),
                &["branch", "--list", location.branch.as_ref().unwrap()],
            )
            .is_empty()
        );
    }
}

#[tokio::test]
async fn deletion_precheck_covers_skipped_missing_worktrees_and_explicit_discard() {
    let f = fixture().await;
    // Reproduce the reported state: missing checkouts, skipped Finish, retained refs.
    for location in &f.repositories {
        git(
            Path::new(&location.source_root),
            &[
                "worktree",
                "remove",
                location.checkout_path.as_ref().unwrap(),
            ],
        );
    }
    let plan = f
        .repositories
        .iter()
        .map(|r| FinishPlanItem {
            commit_message: None,
            repository_id: r.id.clone(),
            code_action: "skip".into(),
            delete_worktree: false,
            delete_branch: false,
            preflight_id: String::new(),
        })
        .collect();
    run_batch(
        &f.state,
        prepare_batch(&f.state, &f.workspace.id, plan)
            .await
            .unwrap(),
        false,
    )
    .await
    .unwrap();
    let preview = deletion_preview(&f).await;
    assert_eq!(preview.undelivered_branches.len(), 2);
    for branch in &preview.undelivered_branches {
        assert_eq!(branch.workspace_name, f.workspace.name);
        assert_eq!(branch.branch, "feature/batch");
        assert_eq!(branch.commit_count, 1);
    }
    let error = delete_workspace(
        State(f.state.clone()),
        AxumPath(f.workspace.id.clone()),
        Query(cleanup_options()),
    )
    .await
    .unwrap_err();
    assert!(matches!(
        error,
        AppError::Api {
            code: "WORKSPACE_DELETE_UNDELIVERED",
            ..
        }
    ));
    assert!(f.state.store.workspace(&f.workspace.id).await.is_ok());
    let status = delete_workspace(
        State(f.state.clone()),
        AxumPath(f.workspace.id.clone()),
        Query(DeleteWorkspaceOptions {
            discard_token: preview.discard_token,
            ..cleanup_options()
        }),
    )
    .await
    .unwrap();
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert!(f.state.store.workspace(&f.workspace.id).await.is_err());
    for location in &f.repositories {
        assert!(
            git(
                Path::new(&location.source_root),
                &["branch", "--list", "feature/batch"]
            )
            .is_empty()
        );
    }
}

#[tokio::test]
async fn deletion_rejects_stale_approval_before_any_cleanup_and_allows_fresh_approval() {
    let f = fixture().await;
    finish_retained(&f).await;
    commit(
        Path::new(f.repositories[0].checkout_path.as_ref().unwrap()),
        "late.txt",
        "late",
    );
    let preview = deletion_preview(&f).await;
    assert_eq!(preview.undelivered_branches.len(), 1);
    assert_eq!(preview.undelivered_branches[0].repository_name, "backend");
    // A previously safe repository acquires a new commit after the user confirms.
    commit(
        Path::new(f.repositories[1].checkout_path.as_ref().unwrap()),
        "new.txt",
        "new",
    );
    let error = delete_workspace(
        State(f.state.clone()),
        AxumPath(f.workspace.id.clone()),
        Query(DeleteWorkspaceOptions {
            discard_token: preview.discard_token,
            ..cleanup_options()
        }),
    )
    .await
    .unwrap_err();
    assert!(matches!(
        error,
        AppError::Api {
            code: "WORKSPACE_DELETE_CHANGED",
            ..
        }
    ));
    assert_checkouts_preserved(&f);
    let fresh = deletion_preview(&f).await;
    assert_eq!(fresh.undelivered_branches.len(), 2);
    delete_workspace(
        State(f.state.clone()),
        AxumPath(f.workspace.id.clone()),
        Query(DeleteWorkspaceOptions {
            discard_token: fresh.discard_token,
            ..cleanup_options()
        }),
    )
    .await
    .unwrap();
    assert!(f.state.store.workspace(&f.workspace.id).await.is_err());
}

#[tokio::test]
async fn deletion_discard_does_not_bypass_dirty_checkout_or_branch_ownership() {
    let f = fixture().await;
    finish_retained(&f).await;
    let first = Path::new(f.repositories[0].checkout_path.as_ref().unwrap());
    let last = Path::new(f.repositories[1].checkout_path.as_ref().unwrap());
    commit(first, "late.txt", "late");
    commit(last, "user.txt", "user-owned commit");
    sqlx::query("UPDATE workspace_repositories SET branch_ownership='user' WHERE id=?")
        .bind(&f.repositories[1].id)
        .execute(&f.state.store.pool)
        .await
        .unwrap();
    let preview = deletion_preview(&f).await;
    assert_eq!(preview.undelivered_branches.len(), 1);
    std::fs::write(last.join("dirty.txt"), "uncommitted").unwrap();
    let options = DeleteWorkspaceOptions {
        discard_token: preview.discard_token,
        ..cleanup_options()
    };
    assert!(
        delete_workspace(
            State(f.state.clone()),
            AxumPath(f.workspace.id.clone()),
            Query(options.clone())
        )
        .await
        .is_err()
    );
    assert_checkouts_preserved(&f);
    std::fs::remove_file(last.join("dirty.txt")).unwrap();
    delete_workspace(
        State(f.state.clone()),
        AxumPath(f.workspace.id.clone()),
        Query(options),
    )
    .await
    .unwrap();
    assert!(!first.exists() && !last.exists());
    assert_eq!(
        git(&f.roots[1], &["show", "feature/batch:user.txt"]),
        "user-owned commit"
    );
}

#[tokio::test]
async fn deletion_discard_cascades_archived_forks_and_preserves_source_branches() {
    let mut f = fixture().await;
    let parent = f.workspace.clone();
    let parent_repositories = f.repositories.clone();
    f.workspace = crate::server::fork::create_fork_impl(
        f.state.clone(),
        parent.id.clone(),
        crate::server::fork::CreateFork {
            description: None,
            branch: Some("task/discard-child".into()),
            generated_branch: None,
        },
    )
    .await
    .unwrap()
    .workspace;
    f.repositories = f
        .state
        .store
        .workspace_repositories(&f.workspace.id)
        .await
        .unwrap();
    finish_retained(&f).await;
    commit(
        Path::new(f.repositories[0].checkout_path.as_ref().unwrap()),
        "fork-late.txt",
        "late fork work",
    );
    let fork_id = f.workspace.id.clone();
    let fork_name = f.workspace.name.clone();
    let fork_paths: Vec<_> = f
        .repositories
        .iter()
        .map(|r| r.checkout_path.clone().unwrap())
        .collect();
    f.workspace = parent;
    f.repositories = parent_repositories;
    finish_retained(&f).await;
    let heads: Vec<_> = f
        .roots
        .iter()
        .map(|root| git(root, &["rev-parse", "main"]))
        .collect();
    let preview = deletion_preview(&f).await;
    assert_eq!(preview.undelivered_branches.len(), 1);
    assert_eq!(preview.undelivered_branches[0].workspace_name, fork_name);
    delete_workspace(
        State(f.state.clone()),
        AxumPath(f.workspace.id.clone()),
        Query(DeleteWorkspaceOptions {
            discard_token: preview.discard_token,
            ..cleanup_options()
        }),
    )
    .await
    .unwrap();
    assert!(f.state.store.workspace(&fork_id).await.is_err());
    assert!(f.state.store.workspace(&f.workspace.id).await.is_err());
    assert!(fork_paths.iter().all(|p| !Path::new(p).exists()));
    for (root, head) in f.roots.iter().zip(heads) {
        assert_eq!(git(root, &["rev-parse", "main"]), head);
        assert!(
            git(
                root,
                &["branch", "--list", "feature/batch", "task/discard-child"]
            )
            .is_empty()
        );
    }
}

#[tokio::test]
async fn archived_cleanup_project_skips_unmerged_and_dirty_then_removes_merged() {
    let f = fixture().await;
    finish_retained(&f).await;
    let last = Path::new(f.repositories[1].checkout_path.as_ref().unwrap());
    commit(last, "late.txt", "unmerged");
    let cleanup = || {
        cleanup_project(
            State(f.state.clone()),
            AxumPath(f.workspace.project_id.clone()),
        )
    };
    let result = cleanup().await.unwrap().0;
    assert!(result.deleted_ids.is_empty());
    assert_eq!(result.skipped.len(), 1);
    assert_eq!(result.skipped[0].reason, "unmerged");
    assert_checkouts_preserved(&f);
    git(&f.roots[1], &["merge", "--ff-only", "feature/batch"]);
    std::fs::write(last.join("dirty.txt"), "dirty").unwrap();
    let result = cleanup().await.unwrap().0;
    assert!(result.deleted_ids.is_empty());
    assert_eq!(result.skipped[0].reason, "cleanup_blocked");
    assert_checkouts_preserved(&f);
    std::fs::remove_file(last.join("dirty.txt")).unwrap();
    let result = cleanup().await.unwrap().0;
    assert_eq!(result.deleted_ids, vec![f.workspace.id.clone()]);
    assert!(result.skipped.is_empty());
    for location in &f.repositories {
        assert!(!Path::new(location.checkout_path.as_ref().unwrap()).exists());
        assert!(
            git(
                Path::new(&location.source_root),
                &["branch", "--list", "feature/batch"]
            )
            .is_empty()
        );
    }
    assert!(cleanup().await.unwrap().0.deleted_ids.is_empty());
}

#[tokio::test]
async fn archived_cleanup_skips_pushed_but_unmerged_branches() {
    let f = fixture().await;
    for location in &f.repositories {
        let root = Path::new(&location.source_root);
        let head = git(root, &["rev-parse", "feature/batch"]);
        git(
            root,
            &["update-ref", "refs/remotes/origin/feature/batch", &head],
        );
        sqlx::query("UPDATE workspace_repositories SET remote_name='origin',remote_branch='feature/batch' WHERE id=?")
            .bind(&location.id).execute(&f.state.store.pool).await.unwrap();
    }
    f.state
        .store
        .finish_workspace(&f.workspace.id, "pushed", "push_branch", None, "now")
        .await
        .unwrap();
    // Preserve the established single-delete contract for remote-delivered work.
    assert!(deletion_preview(&f).await.undelivered_branches.is_empty());
    let result = cleanup_project(
        State(f.state.clone()),
        AxumPath(f.workspace.project_id.clone()),
    )
    .await
    .unwrap()
    .0;
    assert!(result.deleted_ids.is_empty());
    assert_eq!(result.skipped[0].reason, "unmerged");
    assert_checkouts_preserved(&f);
}

#[tokio::test]
async fn archived_cleanup_forks_continues_past_blocked_items_and_preserves_active_scope() {
    let f = fixture().await;
    let mut archived = Vec::new();
    for (branch, unmerged) in [
        ("task/blocked", true),
        ("task/merged", false),
        ("task/active", false),
    ] {
        let (_, Json(fork)) = create_fork(
            State(f.state.clone()),
            AxumPath(f.workspace.id.clone()),
            ApiJson(crate::server::fork::CreateFork {
                description: None,
                branch: Some(branch.into()),
                generated_branch: None,
            }),
        )
        .await
        .unwrap();
        let repos = f
            .state
            .store
            .workspace_repositories(&fork.id)
            .await
            .unwrap();
        if unmerged {
            commit(
                Path::new(repos[0].checkout_path.as_ref().unwrap()),
                "fork.txt",
                "unique",
            );
        }
        if branch != "task/active" {
            // Merge the safe branch into source; archive without deleting resources.
            if !unmerged {
                for root in &f.roots {
                    git(root, &["merge", "--ff-only", branch]);
                }
            }
            f.state
                .store
                .finish_workspace(&fork.id, "kept", "skip", None, "now")
                .await
                .unwrap();
        }
        archived.push((fork, repos));
    }
    // Project cleanup must not traverse Forks under an active Workspace.
    let project = cleanup_project(
        State(f.state.clone()),
        AxumPath(f.workspace.project_id.clone()),
    )
    .await
    .unwrap()
    .0;
    assert!(project.deleted_ids.is_empty() && project.skipped.is_empty());
    for (fork, repositories) in &archived {
        assert!(f.state.store.workspace(&fork.id).await.is_ok());
        assert!(
            repositories
                .iter()
                .all(|r| Path::new(r.checkout_path.as_ref().unwrap()).exists())
        );
    }
    let result = cleanup_forks(State(f.state.clone()), AxumPath(f.workspace.id.clone()))
        .await
        .unwrap()
        .0;
    assert_eq!(result.deleted_ids, vec![archived[1].0.id.clone()]);
    assert_eq!(result.skipped.len(), 1);
    assert_eq!(result.skipped[0].id, archived[0].0.id);
    assert_eq!(result.skipped[0].reason, "unmerged");
    for index in [0, 2] {
        assert!(f.state.store.workspace(&archived[index].0.id).await.is_ok());
        assert!(
            archived[index]
                .1
                .iter()
                .all(|r| Path::new(r.checkout_path.as_ref().unwrap()).exists())
        );
    }
    assert!(f.state.store.workspace(&f.workspace.id).await.is_ok());
    assert!(f.state.store.workspace(&archived[1].0.id).await.is_err());
}

#[tokio::test]
async fn archived_cleanup_removes_safe_forks_before_a_blocked_parent_and_retries() {
    let f = fixture().await;
    let mut forks = Vec::new();
    for branch in ["task/clean", "task/dirty"] {
        let (_, Json(fork)) = create_fork(
            State(f.state.clone()),
            AxumPath(f.workspace.id.clone()),
            ApiJson(crate::server::fork::CreateFork {
                description: None,
                branch: Some(branch.into()),
                generated_branch: None,
            }),
        )
        .await
        .unwrap();
        let repositories = f
            .state
            .store
            .workspace_repositories(&fork.id)
            .await
            .unwrap();
        f.state
            .store
            .finish_workspace(&fork.id, "kept", "skip", None, "now")
            .await
            .unwrap();
        forks.push((fork, repositories));
    }
    finish_retained(&f).await;
    let dirty_path = Path::new(forks[1].1[0].checkout_path.as_ref().unwrap()).join("dirty.txt");
    std::fs::write(&dirty_path, "uncommitted").unwrap();
    let cleanup = || {
        cleanup_project(
            State(f.state.clone()),
            AxumPath(f.workspace.project_id.clone()),
        )
    };
    let result = cleanup().await.unwrap().0;
    assert_eq!(result.deleted_ids, vec![forks[0].0.id.clone()]);
    assert_eq!(result.skipped.len(), 2);
    assert!(result.skipped.iter().any(|item| item.id == forks[1].0.id));
    assert!(result.skipped.iter().any(|item| item.id == f.workspace.id));
    assert_checkouts_preserved(&f);
    assert!(
        forks[1]
            .1
            .iter()
            .all(|r| Path::new(r.checkout_path.as_ref().unwrap()).exists())
    );
    assert!(f.state.store.workspace(&forks[0].0.id).await.is_err());
    assert!(
        forks[0]
            .1
            .iter()
            .all(|r| !Path::new(r.checkout_path.as_ref().unwrap()).exists())
    );

    std::fs::remove_file(dirty_path).unwrap();
    let result = cleanup().await.unwrap().0;
    assert_eq!(
        result.deleted_ids,
        vec![forks[1].0.id.clone(), f.workspace.id.clone()]
    );
    assert!(result.skipped.is_empty());
    forks.push((f.workspace.clone(), f.repositories.clone()));
    for (workspace, repositories) in &forks {
        assert!(f.state.store.workspace(&workspace.id).await.is_err());
        for repository in repositories {
            assert!(!Path::new(repository.checkout_path.as_ref().unwrap()).exists());
            assert!(
                git(
                    Path::new(&repository.source_root),
                    &["branch", "--list", repository.branch.as_ref().unwrap()]
                )
                .is_empty()
            );
        }
    }
    let result = cleanup().await.unwrap().0;
    assert!(result.deleted_ids.is_empty() && result.skipped.is_empty());
}

#[tokio::test]
async fn archived_cleanup_checks_user_branches_and_recognizes_merge_into_parent() {
    let f = fixture().await;
    let (_, Json(fork)) = create_fork(
        State(f.state.clone()),
        AxumPath(f.workspace.id.clone()),
        ApiJson(crate::server::fork::CreateFork {
            description: None,
            branch: Some("task/parent-merge".into()),
            generated_branch: None,
        }),
    )
    .await
    .unwrap();
    let repos = f
        .state
        .store
        .workspace_repositories(&fork.id)
        .await
        .unwrap();
    commit(
        Path::new(repos[0].checkout_path.as_ref().unwrap()),
        "child.txt",
        "unmerged",
    );
    sqlx::query("UPDATE workspace_repositories SET branch_ownership='user' WHERE id=?")
        .bind(&repos[0].id)
        .execute(&f.state.store.pool)
        .await
        .unwrap();
    f.state
        .store
        .finish_workspace(&fork.id, "kept", "skip", None, "now")
        .await
        .unwrap();
    let cleanup = || cleanup_forks(State(f.state.clone()), AxumPath(f.workspace.id.clone()));
    let result = cleanup().await.unwrap().0;
    assert!(result.deleted_ids.is_empty());
    assert_eq!(result.skipped[0].reason, "unmerged");
    assert!(
        repos
            .iter()
            .all(|r| Path::new(r.checkout_path.as_ref().unwrap()).exists())
    );
    for parent in &f.repositories {
        git(
            Path::new(parent.checkout_path.as_ref().unwrap()),
            &["merge", "--ff-only", "task/parent-merge"],
        );
    }
    let result = cleanup().await.unwrap().0;
    assert_eq!(result.deleted_ids, vec![fork.id]);
    assert!(result.skipped.is_empty());
    assert!(
        repos
            .iter()
            .all(|r| !Path::new(r.checkout_path.as_ref().unwrap()).exists())
    );
    assert!(
        !git(
            Path::new(&repos[0].source_root),
            &["branch", "--list", "task/parent-merge"]
        )
        .is_empty()
    );
    assert!(
        git(
            Path::new(&repos[1].source_root),
            &["branch", "--list", "task/parent-merge"]
        )
        .is_empty()
    );
}

async fn cleanup_project(
    state: State<AppState>,
    id: AxumPath<String>,
) -> Result<Json<crate::model::ArchivedCleanupResult>> {
    let (_, Json(task)) = crate::server::archived_cleanup::project(state.clone(), id).await?;
    Ok(Json(
        crate::server::archived_cleanup::wait(&state.0, &task.id).await,
    ))
}
async fn cleanup_forks(
    state: State<AppState>,
    id: AxumPath<String>,
) -> Result<Json<crate::model::ArchivedCleanupResult>> {
    let (_, Json(task)) = crate::server::archived_cleanup::workspace(state.clone(), id).await?;
    Ok(Json(
        crate::server::archived_cleanup::wait(&state.0, &task.id).await,
    ))
}

#[tokio::test]
async fn archived_cleanup_tasks_share_ids_and_release_global_lock_while_waiting() {
    let f = fixture().await;
    finish_retained(&f).await;
    let guard = crate::server::workspace_lifecycle::lock(&f.state, &f.workspace.id)
        .await
        .unwrap();
    let (status, Json(first)) = crate::server::archived_cleanup::project(
        State(f.state.clone()),
        AxumPath(f.workspace.project_id.clone()),
    )
    .await
    .unwrap();
    let (_, Json(second)) = crate::server::archived_cleanup::project(
        State(f.state.clone()),
        AxumPath(f.workspace.project_id.clone()),
    )
    .await
    .unwrap();
    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(first.id, second.id);
    assert_eq!(first.status, "running");
    let other = fixture().await;
    finish_retained(&other).await;
    let result = cleanup_project(
        State(other.state.clone()),
        AxumPath(other.workspace.project_id.clone()),
    )
    .await
    .unwrap()
    .0;
    assert_eq!(result.deleted_ids, vec![other.workspace.id.clone()]);
    assert!(workers().try_lock().is_ok());
    let Json(tasks) = crate::server::archived_cleanup::list(State(f.state.clone())).await;
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0].status, "running");
    drop(guard);
    let result = crate::server::archived_cleanup::wait(&f.state, &first.id).await;
    assert_eq!(result.deleted_ids, vec![f.workspace.id.clone()]);
    let Json(tasks) = crate::server::archived_cleanup::list(State(f.state.clone())).await;
    assert_eq!(tasks[0].completed, tasks[0].total);
}

#[tokio::test]
async fn archived_cleanup_removes_only_safe_unowned_managed_worktrees() {
    let f = fixture().await;
    let root = &f.roots[0];
    let managed = f.state.settings.treefold_home().join("git/w");
    std::fs::create_dir_all(&managed).unwrap();
    let mut paths = Vec::new();
    for name in [
        "clean-orphan",
        "missing-orphan",
        "dirty-orphan",
        "ignored-orphan",
        "locked-orphan",
        "unmerged-orphan",
    ] {
        let path = managed.join(name);
        git(
            root,
            &["worktree", "add", "-b", name, path.to_str().unwrap()],
        );
        paths.push(path);
    }
    std::fs::remove_dir_all(&paths[1]).unwrap();
    std::fs::write(paths[2].join("dirty.txt"), "keep").unwrap();
    std::fs::write(
        root.join(".git/info/exclude"),
        "ignored.txt
",
    )
    .unwrap();
    std::fs::write(paths[3].join("ignored.txt"), "keep").unwrap();
    git(root, &["worktree", "lock", paths[4].to_str().unwrap()]);
    commit(&paths[5], "unmerged.txt", "keep");
    let external = f.state.settings.treefold_home().join("external");
    git(
        root,
        &[
            "worktree",
            "add",
            "-b",
            "external-orphan",
            external.to_str().unwrap(),
        ],
    );
    let result = cleanup_project(
        State(f.state.clone()),
        AxumPath(f.workspace.project_id.clone()),
    )
    .await
    .unwrap()
    .0;
    assert!(result.deleted_ids.is_empty());
    assert_eq!(result.orphan_paths.len(), 2);
    assert_eq!(result.skipped.len(), 4);
    assert!(!paths[0].exists());
    for path in &paths[2..] {
        assert!(path.exists());
    }
    assert!(external.exists());
    assert_checkouts_preserved(&f);
    assert!(
        !git(
            root,
            &["branch", "--list", "clean-orphan", "missing-orphan"]
        )
        .is_empty()
    );
    let result = cleanup_project(
        State(f.state.clone()),
        AxumPath(f.workspace.project_id.clone()),
    )
    .await
    .unwrap()
    .0;
    assert!(result.orphan_paths.is_empty());
    assert_eq!(result.skipped.len(), 4);
}

#[tokio::test]
async fn archived_cleanup_preserves_other_projects_owned_worktrees() {
    let f = fixture().await;
    let (_, Json(project)) = create_project(
        State(f.state.clone()),
        ApiJson(CreateProject {
            open_path: None,
            name: Some("Other Project".into()),
            description: None,
            path: None,
            locations: None,
            preferred_remote: None,
            directory_description: None,
            directory_worktree_setup_command: None,
        }),
    )
    .await
    .unwrap();
    let _ = crate::server::create_directory(
        State(f.state.clone()),
        AxumPath(project.id.clone()),
        ApiJson(crate::server::workspace::CreateDirectory {
            path: f.roots[0].to_string_lossy().into_owned(),
            description: None,
            worktree_setup_command: None,
        }),
    )
    .await
    .unwrap();
    let repository = f
        .state
        .store
        .repositories(&project.id)
        .await
        .unwrap()
        .remove(0);
    let path = f.state.settings.treefold_home().join("git/w/cross-project");
    git(
        &f.roots[0],
        &[
            "worktree",
            "add",
            "-b",
            "cross-project",
            path.to_str().unwrap(),
        ],
    );
    let mut workspace = f.workspace.clone();
    workspace.id = crate::ids::new_id();
    workspace.project_id = project.id;
    workspace.status = "archived".into();
    let mut location = f.repositories[0].clone();
    location.id = crate::ids::new_id();
    location.workspace_id = workspace.id.clone();
    location.project_repository_id = repository.id;
    location.checkout_path = Some(path.to_string_lossy().into_owned());
    location.branch = Some("cross-project".into());
    f.state
        .store
        .create_workspace_with_repositories(&workspace, &[location])
        .await
        .unwrap();
    let result = cleanup_project(
        State(f.state.clone()),
        AxumPath(f.workspace.project_id.clone()),
    )
    .await
    .unwrap()
    .0;
    assert!(result.orphan_paths.is_empty());
    assert!(result.skipped.is_empty());
    assert!(path.exists());
}
