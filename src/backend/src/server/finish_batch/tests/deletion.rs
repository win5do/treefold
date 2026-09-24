use super::*;
use crate::server::workspace_delete::{DeleteWorkspaceOptions, delete_workspace};
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
    };
    assert!(
        delete_workspace(
            State(f.state.clone()),
            AxumPath(f.workspace.id.clone()),
            Query(cleanup)
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
            Query(cleanup)
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
    };
    assert!(
        delete_workspace(
            State(f.state.clone()),
            AxumPath(f.workspace.id.clone()),
            Query(cleanup)
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
        Query(cleanup),
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
