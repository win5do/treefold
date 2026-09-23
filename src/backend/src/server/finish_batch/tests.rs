use super::*;
use crate::{
    keymap::KeymapStore,
    model::{Workspace, WorkspaceRepository},
    server::{
        CreateProject, CreateWorkspace, RuntimeHub, command_output, create_project,
        create_workspace, git_head, reconcile_parent_operation, undo_parent_operation_impl,
    },
    settings::SettingsStore,
    store::Store,
    terminal::TerminalManager,
};
use std::path::{Path, PathBuf};

struct Fixture {
    state: AppState,
    workspace: Workspace,
    repositories: Vec<WorkspaceRepository>,
    roots: Vec<PathBuf>,
    _directory: tempfile::TempDir,
}

fn git(path: &Path, args: &[&str]) -> String {
    command_output(path, "git", args).unwrap()
}
fn commit(path: &Path, file: &str, contents: &str) {
    std::fs::write(path.join(file), contents).unwrap();
    git(path, &["add", file]);
    git(path, &["commit", "-m", file]);
}
async fn state(home: &Path) -> AppState {
    AppState {
        store: Store::open(&home.join("data")).await.unwrap(),
        keymap: KeymapStore::open(home).unwrap(),
        settings: SettingsStore::open(home).unwrap(),
        terminals: TerminalManager::default(),
        runtime: RuntimeHub::default(),
        integration: crate::integration::IntegrationManager::test(home),
    }
}
async fn fixture() -> Fixture {
    let directory = tempfile::tempdir().unwrap();
    let roots: Vec<_> = ["backend", "frontend"]
        .iter()
        .map(|name| directory.path().join(name))
        .collect();
    for path in &roots {
        std::fs::create_dir_all(path).unwrap();
        git(path, &["init", "-b", "main"]);
        git(path, &["config", "user.email", "treefold@example.test"]);
        git(path, &["config", "user.name", "Treefold Test"]);
        commit(path, "shared.txt", "initial\n");
    }
    let state = state(&directory.path().join("home")).await;
    let (_, Json(project)) = create_project(
        State(state.clone()),
        ApiJson(CreateProject {
            name: Some("Batch".into()),
            description: None,
            path: None,
            locations: Some(
                roots
                    .iter()
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect(),
            ),
            preferred_remote: None,
            default_base_branch: Some("main".into()),
            default_target_branch: Some("main".into()),
            default_delivery_mode: Some("local_merge".into()),
            directory_description: None,
            directory_worktree_setup_command: None,
        }),
    )
    .await
    .unwrap();
    let (_, Json(workspace)) = create_workspace(
        State(state.clone()),
        AxumPath(project.id),
        ApiJson(CreateWorkspace {
            generated_branch: None,
            description: None,
            branch: Some("feature/batch".into()),
            remote_name: None,
            remote_branch: None,
        }),
    )
    .await
    .unwrap();
    let mut repositories = state
        .store
        .workspace_repositories(&workspace.id)
        .await
        .unwrap();
    repositories.sort_by(|a, b| a.repository_name.cmp(&b.repository_name));
    for repository in &repositories {
        commit(
            Path::new(repository.checkout_path.as_ref().unwrap()),
            "shared.txt",
            "feature\n",
        );
    }
    Fixture {
        state,
        workspace,
        repositories,
        roots,
        _directory: directory,
    }
}
async fn plans(f: &Fixture) -> Vec<FinishPlanItem> {
    let mut plans = Vec::new();
    for repository in &f.repositories {
        let (_, Json(preflight)) = create_workspace_repository_preflight_impl(
            f.state.clone(),
            repository.id.clone(),
            CreateDeliveryPreflight {
                code_action: "local_merge".into(),
            },
        )
        .await
        .unwrap();
        plans.push(FinishPlanItem {
            repository_id: repository.id.clone(),
            code_action: "local_merge".into(),
            delete_worktree: true,
            delete_branch: true,
            preflight_id: preflight.id,
        });
    }
    plans
}
async fn batch(f: &Fixture) -> FinishBatch {
    prepare_batch(&f.state, &f.workspace.id, plans(f).await)
        .await
        .unwrap()
}
async fn saved(f: &Fixture) -> FinishBatch {
    f.state
        .store
        .finish_batch(&f.workspace.id)
        .await
        .unwrap()
        .unwrap()
}

#[tokio::test]
async fn finish_batch_requires_all_repositories_and_rechecks_before_any_delivery() {
    let f = fixture().await;
    let plan = plans(&f).await;
    assert!(
        prepare_batch(&f.state, &f.workspace.id, plan[..1].to_vec())
            .await
            .is_err()
    );
    let mut duplicate = plan.clone();
    duplicate.push(plan[0].clone());
    assert!(
        prepare_batch(&f.state, &f.workspace.id, duplicate)
            .await
            .is_err()
    );
    let original = git_head(f.roots[0].to_str().unwrap()).unwrap();
    commit(
        Path::new(f.repositories[1].checkout_path.as_ref().unwrap()),
        "new.txt",
        "changed after preflight",
    );
    assert!(
        prepare_batch(&f.state, &f.workspace.id, plan)
            .await
            .is_err()
    );
    assert_eq!(git_head(f.roots[0].to_str().unwrap()).unwrap(), original);
    assert!(
        f.state
            .store
            .finish_batch(&f.workspace.id)
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
async fn finish_batch_conflict_preserves_all_worktrees_and_resumes_after_restart_without_redelivery()
 {
    let f = fixture().await;
    commit(&f.roots[1], "shared.txt", "parent\n");
    run_batch(&f.state, batch(&f).await, false).await.unwrap();
    let paused = saved(&f).await;
    assert_eq!(paused.status, "paused");
    assert!(paused.items[0].delivered);
    assert!(!paused.items[0].cleaned);
    assert_eq!(paused.items[1].status, "blocked");
    assert_eq!(
        f.state
            .store
            .workspace(&f.workspace.id)
            .await
            .unwrap()
            .status,
        "active"
    );
    for repository in &f.repositories {
        assert!(Path::new(repository.checkout_path.as_ref().unwrap()).exists());
    }
    let first_head = git_head(f.roots[0].to_str().unwrap()).unwrap();
    let first_operation = f
        .state
        .store
        .latest_parent_operation(&f.repositories[0].id, "integrate")
        .await
        .unwrap()
        .unwrap();
    assert!(!first_operation.undo_available);
    assert!(
        undo_parent_operation_impl(&f.state, &first_operation)
            .await
            .is_err()
    );
    // Simulate a fresh server and reconcile a manually resolved parent conflict.
    let restarted = state(&f._directory.path().join("home")).await;
    std::fs::write(f.roots[1].join("shared.txt"), "resolved\n").unwrap();
    git(&f.roots[1], &["add", "shared.txt"]);
    git(
        &f.roots[1],
        &["-c", "core.editor=true", "merge", "--continue"],
    );
    let operation = restarted
        .store
        .parent_operation(paused.items[1].operation_id.as_ref().unwrap())
        .await
        .unwrap();
    let completed = reconcile_parent_operation(&restarted, &operation)
        .await
        .unwrap();
    assert!(!completed.undo_available);
    run_batch(&restarted, paused, true).await.unwrap();
    let finished = saved(&f).await;
    assert_eq!(finished.status, "completed");
    assert!(finished.items.iter().all(|i| i.delivered && i.cleaned));
    assert_eq!(git_head(f.roots[0].to_str().unwrap()).unwrap(), first_head);
    assert_eq!(
        f.state
            .store
            .latest_parent_operation(&f.repositories[0].id, "integrate")
            .await
            .unwrap()
            .unwrap()
            .id,
        first_operation.id
    );
    assert_eq!(
        restarted
            .store
            .workspace(&f.workspace.id)
            .await
            .unwrap()
            .status,
        "archived"
    );
    for (repository, root) in f.repositories.iter().zip(&f.roots) {
        assert!(!Path::new(repository.checkout_path.as_ref().unwrap()).exists());
        assert!(git(root, &["branch", "--list", "feature/batch"]).is_empty());
    }
}

#[tokio::test]
async fn finish_batch_cleanup_retry_preserves_new_source_commits_and_never_redelivers() {
    let f = fixture().await;
    let mut initial = batch(&f).await;
    // Persist after delivery but before cleanup, as if the process stopped there.
    for item in &mut initial.items {
        let _ = finish_workspace_repository_impl(
            f.state.clone(),
            item.plan.repository_id.clone(),
            input(&item.plan, false),
        )
        .await
        .unwrap();
        item.delivered = true;
        item.status = "delivered".into();
    }
    // Crash between saving the Repository outcome and saving the batch item.
    initial.items[0].delivered = false;
    initial.items[0].status = "delivering".into();
    f.state.store.save_finish_batch(&initial).await.unwrap();
    let Json(interrupted) =
        get_finish_batch(State(f.state.clone()), AxumPath(f.workspace.id.clone()))
            .await
            .unwrap();
    assert_eq!(interrupted.unwrap().status, "paused");
    let source = Path::new(f.repositories[0].checkout_path.as_ref().unwrap());
    let delivered_head = git_head(source.to_str().unwrap()).unwrap();
    commit(source, "late.txt", "new work\n");
    run_batch(&f.state, initial, true).await.unwrap();
    let paused = saved(&f).await;
    assert_eq!(paused.status, "paused");
    assert!(
        paused.items[0]
            .error
            .as_ref()
            .unwrap()
            .contains("source branch changed")
    );
    assert!(source.exists());
    assert_eq!(
        git_head(f.roots[0].to_str().unwrap()).unwrap(),
        delivered_head
    );
    // User preserves new work separately and restores the originally confirmed source.
    git(source, &["branch", "saved-late-work"]);
    git(source, &["reset", "--hard", &delivered_head]);
    run_batch(&f.state, paused, true).await.unwrap();
    assert_eq!(saved(&f).await.status, "completed");
    assert_eq!(
        git_head(f.roots[0].to_str().unwrap()).unwrap(),
        delivered_head
    );
    assert!(!git(&f.roots[0], &["branch", "--list", "saved-late-work"]).is_empty());
}

#[tokio::test]
async fn finish_batch_runs_in_background_and_duplicate_start_cannot_execute_twice() {
    let f = fixture().await;
    let plans = plans(&f).await;
    let (status, Json(started)) = start_finish_batch(
        State(f.state.clone()),
        AxumPath(f.workspace.id.clone()),
        ApiJson(FinishBatchRequest {
            repositories: plans.clone(),
        }),
    )
    .await
    .unwrap();
    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(started.status, "running");
    assert!(
        start_finish_batch(
            State(f.state.clone()),
            AxumPath(f.workspace.id.clone()),
            ApiJson(FinishBatchRequest {
                repositories: plans
            })
        )
        .await
        .is_err()
    );
    tokio::time::timeout(std::time::Duration::from_secs(20), async {
        loop {
            let Json(current) =
                get_finish_batch(State(f.state.clone()), AxumPath(f.workspace.id.clone()))
                    .await
                    .unwrap();
            if current.unwrap().status == "completed"
                && !workers().lock().await.contains(&f.workspace.id)
            {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(30)).await;
        }
    })
    .await
    .unwrap();
    let Json(retried) =
        resume_finish_batch(State(f.state.clone()), AxumPath(f.workspace.id.clone()))
            .await
            .unwrap();
    assert_eq!(retried.status, "completed");
}

#[tokio::test]
async fn finish_batch_fork_merges_all_repositories_into_parent_and_completes_todo() {
    use crate::model::Todo;
    use crate::server::{CreateFork, create_fork};
    let mut f = fixture().await;
    let parent = f.workspace.clone();
    let parent_repositories = f.repositories.clone();
    let (_, Json(fork)) = create_fork(
        State(f.state.clone()),
        AxumPath(parent.id.clone()),
        ApiJson(CreateFork {
            generated_branch: None,
            branch: None,
            description: None,
        }),
    )
    .await
    .unwrap();
    assert!(
        prepare_batch(&f.state, &parent.id, plans(&f).await)
            .await
            .is_err()
    );
    let todo = Todo {
        id: crate::server::new_id(),
        workspace_id: parent.id.clone(),
        content: "Finish subtask".into(),
        status: "in_progress".into(),
        fork_id: Some(fork.id.clone()),
        blocked_reason: None,
        created_at: crate::store::now(),
        updated_at: crate::store::now(),
    };
    f.state.store.create_todo(&todo).await.unwrap();
    f.workspace = fork;
    f.repositories = f
        .state
        .store
        .workspace_repositories(&f.workspace.id)
        .await
        .unwrap();
    for repository in &f.repositories {
        commit(
            Path::new(repository.checkout_path.as_ref().unwrap()),
            "subtask.txt",
            "completed subtask",
        );
    }
    run_batch(&f.state, batch(&f).await, false).await.unwrap();
    assert_eq!(saved(&f).await.status, "completed");
    assert_eq!(f.state.store.todo(&todo.id).await.unwrap().status, "done");
    assert_eq!(
        f.state.store.workspace(&parent.id).await.unwrap().status,
        "active"
    );
    for repository in &parent_repositories {
        assert!(
            Path::new(repository.checkout_path.as_ref().unwrap())
                .join("subtask.txt")
                .exists()
        );
    }
    for root in &f.roots {
        assert!(!root.join("subtask.txt").exists());
    }
    // Once the parent confirms its plan, new Forks cannot race with cleanup.
    f.workspace = parent.clone();
    f.repositories = parent_repositories;
    f.state
        .store
        .save_finish_batch(&batch(&f).await)
        .await
        .unwrap();
    assert!(
        create_fork(
            State(f.state.clone()),
            AxumPath(parent.id),
            ApiJson(CreateFork {
                generated_branch: None,
                branch: None,
                description: None
            })
        )
        .await
        .is_err()
    );
}

#[tokio::test]
async fn finish_batch_http_contract_persists_the_complete_plan() {
    use axum::{
        body::{Body, to_bytes},
        http::Request,
    };
    use tower::ServiceExt;
    let f = fixture().await;
    let router = crate::server::app(f.state.clone());
    let url = format!("/api/workspaces/{}/finish-batch", f.workspace.id);
    let empty = router
        .clone()
        .oneshot(Request::builder().uri(&url).body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(empty.status(), StatusCode::OK);
    assert_eq!(
        to_bytes(empty.into_body(), usize::MAX)
            .await
            .unwrap()
            .as_ref(),
        b"null"
    );
    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(&url)
                .header("Content-Type", "application/json")
                .body(Body::from(
                    serde_json::json!({"repositories":plans(&f).await}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::ACCEPTED);
    let accepted: FinishBatch =
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(accepted.items.len(), 2);
    tokio::time::timeout(std::time::Duration::from_secs(20), async {
        loop {
            if !workers().lock().await.contains(&f.workspace.id) {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(30)).await;
        }
    })
    .await
    .unwrap();
    let resumed = router
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("{url}/resume"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resumed.status(), StatusCode::OK);
    let completed: FinishBatch =
        serde_json::from_slice(&to_bytes(resumed.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(completed.status, "completed");
}

#[tokio::test]
async fn finish_batch_archives_legacy_completed_repositories_without_repeating_delivery() {
    let f = fixture().await;
    for plan in plans(&f).await {
        let _ = finish_workspace_repository_impl(
            f.state.clone(),
            plan.repository_id.clone(),
            input(&plan, false),
        )
        .await
        .unwrap();
    }
    let batch = prepare_batch(&f.state, &f.workspace.id, Vec::new())
        .await
        .unwrap();
    assert!(batch.items.is_empty());
    run_batch(&f.state, batch, false).await.unwrap();
    assert_eq!(
        f.state
            .store
            .workspace(&f.workspace.id)
            .await
            .unwrap()
            .status,
        "archived"
    );
    assert_eq!(saved(&f).await.status, "completed");
    for repository in f.repositories {
        assert!(Path::new(repository.checkout_path.as_ref().unwrap()).exists());
    }
}

mod recovery;

async fn squash_plans(f: &Fixture, cleanup: bool) -> Vec<FinishPlanItem> {
    let mut plans = plans(f).await;
    for plan in &mut plans {
        plan.code_action = "squash_merge".into();
        plan.delete_worktree = cleanup;
        plan.delete_branch = cleanup;
        let (_, Json(check)) = create_workspace_repository_preflight_impl(
            f.state.clone(),
            plan.repository_id.clone(),
            CreateDeliveryPreflight {
                code_action: "squash_merge".into(),
            },
        )
        .await
        .unwrap();
        plan.preflight_id = check.id;
    }
    plans
}

#[tokio::test]
async fn finish_batch_squash_preserves_source_and_creates_one_target_commit() {
    let f = fixture().await;
    let mut sources = Vec::new();
    for repository in &f.repositories {
        let path = Path::new(repository.checkout_path.as_ref().unwrap());
        commit(path, "second.txt", "second commit");
        sources.push(git(path, &["rev-parse", "HEAD"]));
    }
    let plan = squash_plans(&f, false).await;
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
    for (index, repository) in f.repositories.iter().enumerate() {
        assert_eq!(
            git(
                Path::new(repository.checkout_path.as_ref().unwrap()),
                &["rev-parse", "HEAD"]
            ),
            sources[index]
        );
        assert_eq!(git(&f.roots[index], &["rev-list", "--count", "main"]), "2");
        assert_eq!(
            git(&f.roots[index], &["rev-parse", "HEAD^{tree}"]),
            git(
                &f.roots[index],
                &["rev-parse", &format!("{}^{{tree}}", sources[index])]
            )
        );
        assert_eq!(
            f.state
                .store
                .workspace_repository(&repository.id)
                .await
                .unwrap()
                .close_outcome
                .as_deref(),
            Some("squash_merge")
        );
    }
}

#[tokio::test]
async fn finish_batch_squash_conflict_restart_retry_and_cleanup() {
    let f = fixture().await;
    commit(&f.roots[1], "shared.txt", "target conflict");
    let plan = squash_plans(&f, true).await;
    run_batch(
        &f.state,
        prepare_batch(&f.state, &f.workspace.id, plan)
            .await
            .unwrap(),
        false,
    )
    .await
    .unwrap();
    let paused = saved(&f).await;
    assert_eq!(paused.status, "paused");
    assert!(paused.items[0].delivered);
    assert!(!paused.items[0].cleaned);
    let first_head = git(&f.roots[0], &["rev-parse", "HEAD"]);
    let op = f
        .state
        .store
        .latest_parent_operation(&f.repositories[1].id, "integrate")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(op.strategy, "squash");
    assert_eq!(op.status, "conflicted");
    std::fs::write(f.roots[1].join("shared.txt"), "resolved").unwrap();
    git(&f.roots[1], &["add", "shared.txt"]);
    // Polling while conflicts are staged must not incorrectly mark the operation aborted.
    assert_eq!(
        reconcile_parent_operation(&f.state, &op)
            .await
            .unwrap()
            .status,
        "conflicted"
    );
    git(
        &f.roots[1],
        &[
            "commit",
            "-m",
            "resolved",
            "-m",
            &format!("Treefold-Squash: {}", op.id),
        ],
    );
    let restarted = state(&f._directory.path().join("home")).await;
    let completed = reconcile_parent_operation(&restarted, &op).await.unwrap();
    assert_eq!(completed.status, "completed");
    run_batch(&restarted, paused, true).await.unwrap();
    assert_eq!(saved(&f).await.status, "completed");
    assert_eq!(git(&f.roots[0], &["rev-parse", "HEAD"]), first_head);
    for (index, repository) in f.repositories.iter().enumerate() {
        assert!(!Path::new(repository.checkout_path.as_ref().unwrap()).exists());
        assert!(
            !git(&f.roots[index], &["branch", "--list"])
                .contains(repository.branch.as_ref().unwrap())
        );
    }
}

#[tokio::test]
async fn finish_batch_squash_rejects_dirty_worktrees_and_abort_restores_target() {
    let f = fixture().await;
    let source = Path::new(f.repositories[0].checkout_path.as_ref().unwrap());
    std::fs::write(source.join("untracked"), "untracked").unwrap();
    let plan = squash_plans(&f, false).await;
    assert!(
        prepare_batch(&f.state, &f.workspace.id, plan)
            .await
            .is_err()
    );
    std::fs::remove_file(source.join("untracked")).unwrap();
    std::fs::write(f.roots[0].join("untracked"), "untracked").unwrap();
    let plan = squash_plans(&f, false).await;
    assert!(
        prepare_batch(&f.state, &f.workspace.id, plan)
            .await
            .is_err()
    );
    std::fs::remove_file(f.roots[0].join("untracked")).unwrap();
    commit(&f.roots[0], "shared.txt", "conflict");
    let before = git(&f.roots[0], &["rev-parse", "HEAD"]);
    let op = crate::server::start_parent_operation_impl(
        &f.state,
        &f.repositories[0].id,
        "integrate",
        "squash",
        "finish",
        None,
    )
    .await
    .unwrap();
    assert_eq!(op.status, "conflicted");
    let aborted = crate::server::abort_parent_operation_impl(&f.state, &op)
        .await
        .unwrap();
    assert_eq!(aborted.status, "aborted");
    assert_eq!(git(&f.roots[0], &["rev-parse", "HEAD"]), before);
    assert!(git(&f.roots[0], &["status", "--porcelain"]).is_empty());
}

#[tokio::test]
async fn squash_api_enforces_workspace_ownership_and_delivery_boundary() {
    use crate::model::SquashRequest;
    let f = fixture().await;
    let repository = &f.repositories[0];
    let path = Path::new(repository.checkout_path.as_ref().unwrap());
    let first = git(path, &["rev-parse", "HEAD"]);
    commit(path, "second", "second");
    let head = git(path, &["rev-parse", "HEAD"]);
    let request = SquashRequest::Preview {
        commits: vec![first, head.clone()],
        expected_head: head,
    };
    let _ = crate::server::squash::workspace(
        State(f.state.clone()),
        AxumPath(repository.id.clone()),
        ApiJson(request.clone()),
    )
    .await
    .unwrap();
    // Even though squash-delivered source commits are NOT target ancestors,
    // its operation journal must block a later history rewrite.
    let mut delivered = crate::server::start_parent_operation_impl(
        &f.state,
        &repository.id,
        "integrate",
        "squash",
        "standalone",
        None,
    )
    .await
    .unwrap();
    // A newer failed attempt must not hide the earlier successful integration.
    delivered.id = crate::server::new_id();
    delivered.status = "failed".into();
    delivered.phase = "failed".into();
    f.state
        .store
        .create_parent_operation(&delivered)
        .await
        .unwrap();
    assert!(
        crate::server::squash::workspace(
            State(f.state.clone()),
            AxumPath(repository.id.clone()),
            ApiJson(request)
        )
        .await
        .is_err()
    );
}

#[tokio::test]
async fn finish_batch_squash_fork_targets_parent_and_preserves_fork_history() {
    let f = fixture().await;
    let (_, Json(fork)) = crate::server::create_fork(
        State(f.state.clone()),
        AxumPath(f.workspace.id.clone()),
        ApiJson(crate::server::CreateFork {
            generated_branch: None,
            branch: None,
            description: None,
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
    let mut plans = Vec::new();
    let mut heads = Vec::new();
    for repository in &repositories {
        let path = Path::new(repository.checkout_path.as_ref().unwrap());
        commit(path, "fork-one", "one");
        commit(path, "fork-two", "two");
        heads.push(git(path, &["rev-parse", "HEAD"]));
        let (_, Json(check)) = create_workspace_repository_preflight_impl(
            f.state.clone(),
            repository.id.clone(),
            CreateDeliveryPreflight {
                code_action: "squash_merge".into(),
            },
        )
        .await
        .unwrap();
        plans.push(FinishPlanItem {
            repository_id: repository.id.clone(),
            code_action: "squash_merge".into(),
            delete_worktree: false,
            delete_branch: false,
            preflight_id: check.id,
        });
    }
    run_batch(
        &f.state,
        prepare_batch(&f.state, &fork.id, plans).await.unwrap(),
        false,
    )
    .await
    .unwrap();
    for (index, repository) in repositories.iter().enumerate() {
        let parent = f
            .repositories
            .iter()
            .find(|r| r.project_repository_id == repository.project_repository_id)
            .unwrap();
        assert_eq!(
            git(
                Path::new(parent.checkout_path.as_ref().unwrap()),
                &["rev-list", "--count", "HEAD"]
            ),
            "3"
        );
        assert_eq!(
            git(
                Path::new(repository.checkout_path.as_ref().unwrap()),
                &["rev-parse", "HEAD"]
            ),
            heads[index]
        );
    }
    assert_eq!(
        f.state.store.workspace(&fork.id).await.unwrap().status,
        "archived"
    );
    assert_eq!(
        f.state
            .store
            .workspace(&f.workspace.id)
            .await
            .unwrap()
            .status,
        "active"
    );
}

#[tokio::test]
async fn squash_migration_preserves_existing_delivery_records_and_indexes() {
    use sqlx::Connection;
    let f = fixture().await;
    let op = crate::server::start_parent_operation_impl(
        &f.state,
        &f.repositories[0].id,
        "integrate",
        "merge",
        "finish",
        None,
    )
    .await
    .unwrap();
    let database = f._directory.path().join("home/data/treefold_1.sqlite");
    let mut connection =
        sqlx::SqliteConnection::connect(&format!("sqlite://{}", database.display()))
            .await
            .unwrap();
    sqlx::raw_sql("PRAGMA foreign_keys=ON")
        .execute(&mut connection)
        .await
        .unwrap();
    // Reconstruct the pre-change table with real related records present, then
    // apply the exact forward migration to a nonempty operation journal.
    let initial = include_str!("../../../migrations/g1/20260902000000_initial.sql");
    let schema = initial
        .split("CREATE TABLE parent_operations (")
        .nth(1)
        .unwrap()
        .split("CREATE TABLE delivery_preflights")
        .next()
        .unwrap();
    let (columns, indexes) = schema.split_once("CREATE INDEX").unwrap();
    let old_schema = format!(
        "CREATE TABLE parent_operations_old ({columns}INSERT INTO parent_operations_old SELECT * FROM parent_operations; DROP TABLE parent_operations; ALTER TABLE parent_operations_old RENAME TO parent_operations; CREATE INDEX{indexes}"
    );
    sqlx::raw_sql(sqlx::AssertSqlSafe(old_schema))
        .execute(&mut connection)
        .await
        .unwrap();
    sqlx::raw_sql(include_str!(
        "../../../migrations/g1/20260923090000_parent_operation_squash.sql"
    ))
    .execute(&mut connection)
    .await
    .unwrap();
    let restored = f.state.store.parent_operation(&op.id).await.unwrap();
    assert_eq!(restored.source_head, op.source_head);
    assert_eq!(restored.result_head, op.result_head);
    assert_eq!(restored.status, op.status);
    assert_eq!(restored.strategy, "merge");
    let failures = sqlx::query("PRAGMA foreign_key_check")
        .fetch_all(&mut connection)
        .await
        .unwrap();
    assert!(failures.is_empty());
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM sqlite_master WHERE type='index' AND name IN ('parent_operations_repository_updated','parent_operations_target_updated')").fetch_one(&mut connection).await.unwrap();
    assert_eq!(count, 2);
}

#[tokio::test]
async fn squash_project_api_uses_root_boundary_even_with_project_session_records() {
    use crate::model::SquashRequest;
    let f = fixture().await;
    let path = &f.roots[0];
    let base = git(path, &["rev-parse", "HEAD"]);
    commit(path, "project-one", "one");
    let first = git(path, &["rev-parse", "HEAD"]);
    commit(path, "project-two", "two");
    let head = git(path, &["rev-parse", "HEAD"]);
    crate::server::sync_project_session_workspace(&f.state, &f.workspace.project_id)
        .await
        .unwrap();
    let id = f.repositories[0].project_repository_id.clone();
    let Json(preview) = crate::server::squash::project(
        State(f.state.clone()),
        AxumPath(id.clone()),
        ApiJson(SquashRequest::Preview {
            commits: vec![first.clone(), head.clone()],
            expected_head: head.clone(),
        }),
    )
    .await
    .unwrap();
    assert_eq!(preview.preview.unwrap().base, base);
    let Json(result) = crate::server::squash::project(
        State(f.state.clone()),
        AxumPath(id.clone()),
        ApiJson(SquashRequest::Apply {
            commits: vec![first, head.clone()],
            expected_head: head.clone(),
            message: "project squash".into(),
        }),
    )
    .await
    .unwrap();
    let after = git(path, &["rev-parse", "HEAD"]);
    assert_ne!(after, head);
    let _ = crate::server::squash::project(
        State(f.state.clone()),
        AxumPath(id),
        ApiJson(SquashRequest::Undo {
            recovery_id: result.recovery_id.unwrap(),
            expected_head: after,
        }),
    )
    .await
    .unwrap();
    assert_eq!(git(path, &["rev-parse", "HEAD"]), head);
}
