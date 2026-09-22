use super::*;
use crate::server::workspace_repository_git_path;

fn assert_code(error: AppError, expected: &str) {
    assert!(
        matches!(&error, AppError::Api { code, .. } if *code == expected),
        "{error:?}"
    );
}
async fn fork(f: &Fixture) -> Workspace {
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
    f.state
        .store
        .create_todo(&crate::model::Todo {
            id: crate::server::new_id(),
            workspace_id: f.workspace.id.clone(),
            content: "Subtask".into(),
            status: "in_progress".into(),
            fork_id: Some(fork.id.clone()),
            blocked_reason: None,
            created_at: crate::store::now(),
            updated_at: crate::store::now(),
        })
        .await
        .unwrap();
    fork
}

#[tokio::test]
async fn recovery_classifies_actual_worktree_state_and_ignores_stale_cached_health() {
    let f = fixture().await;
    let mut repository = f.repositories[0].clone();
    repository.git_status = "missing".into();
    assert!(workspace_repository_git_path(&repository).is_ok());
    let path = Path::new(repository.checkout_path.as_ref().unwrap());
    std::fs::remove_dir_all(path).unwrap();
    assert_code(
        workspace_repository_git_path(&repository).unwrap_err(),
        "WORKTREE_DIRECTORY_MISSING",
    );
    std::fs::create_dir_all(path).unwrap();
    assert_code(
        workspace_repository_git_path(&repository).unwrap_err(),
        "WORKTREE_NOT_GIT",
    );
    std::fs::write(path.join(".git"), "gitdir: /missing-treefold-metadata").unwrap();
    assert_code(
        workspace_repository_git_path(&repository).unwrap_err(),
        "WORKTREE_GIT_BROKEN",
    );
    // A plain folder within another repository must not inherit its parent's Git identity.
    let nested = f.roots[0].join("plain-folder");
    std::fs::create_dir(&nested).unwrap();
    repository.checkout_path = Some(nested.to_string_lossy().into_owned());
    assert_code(
        workspace_repository_git_path(&repository).unwrap_err(),
        "WORKTREE_NOT_GIT",
    );
}

#[tokio::test]
async fn recovery_batch_persists_structural_error_code_for_reopening() {
    let f = fixture().await;
    let initial = batch(&f).await;
    std::fs::remove_dir_all(f.repositories[0].checkout_path.as_ref().unwrap()).unwrap();
    run_batch(&f.state, initial, false).await.unwrap();
    let paused = saved(&f).await;
    assert_eq!(paused.status, "paused");
    assert_eq!(
        paused.items[0].error_code.as_deref(),
        Some("WORKTREE_DIRECTORY_MISSING")
    );
}

#[tokio::test]
async fn recovery_missing_parent_is_not_a_reason_to_skip_healthy_fork() {
    let f = fixture().await;
    let child = fork(&f).await;
    let repositories = f
        .state
        .store
        .workspace_repositories(&child.id)
        .await
        .unwrap();
    std::fs::remove_dir_all(f.repositories[0].checkout_path.as_ref().unwrap()).unwrap();
    let repository = repositories
        .iter()
        .find(|r| r.project_repository_id == f.repositories[0].project_repository_id)
        .unwrap();
    let error = create_workspace_repository_preflight_impl(
        f.state.clone(),
        repository.id.clone(),
        CreateDeliveryPreflight {
            code_action: "local_merge".into(),
        },
    )
    .await
    .unwrap_err();
    assert_code(error, "PARENT_WORKTREE_DIRECTORY_MISSING");
    assert_code(
        verify_skip(&f.state, &repository.id).await.unwrap_err(),
        "FORCE_SKIP_NOT_AVAILABLE",
    );
}

#[tokio::test]
async fn recovery_rejects_live_sessions_and_accepts_stopped_sessions() {
    use crate::server::{CreateSession, create_session, stop_session};
    let f = fixture().await;
    let (_, Json(session)) = create_session(
        State(f.state.clone()),
        AxumPath(f.workspace.id.clone()),
        ApiJson(CreateSession {
            name: Some("Recovery guard".into()),
            kind: Some("shell".into()),
            project_directory_id: None,
            initial_prompt: None,
        }),
    )
    .await
    .unwrap();
    std::fs::remove_dir_all(f.repositories[0].checkout_path.as_ref().unwrap()).unwrap();
    let rejected = verify_skip(&f.state, &f.repositories[0].id).await;
    let stopped = stop_session(State(f.state.clone()), AxumPath(session.id.clone())).await;
    // Stop acknowledges the request while the process can still be Stopping.
    // Wait for actual termination; a persisted 'stopped' status is insufficient.
    let terminated = tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            let process = f
                .state
                .terminals
                .inspect_existing(&session.amux_workspace_name, &session.amux_process_name)
                .await
                .unwrap();
            if process.is_none_or(|p| {
                !matches!(
                    p.state,
                    amux::model::ProcessState::Created
                        | amux::model::ProcessState::Starting
                        | amux::model::ProcessState::Running
                        | amux::model::ProcessState::Stopping
                )
            }) {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
    })
    .await;
    let allowed = verify_skip(&f.state, &f.repositories[0].id).await;
    // Always clean up the isolated daemon before making assertions.
    f.state.terminals.stop_daemon().await.unwrap();
    assert_code(rejected.unwrap_err(), "FINISH_SESSION_ACTIVE");
    stopped.unwrap();
    terminated.unwrap();
    allowed.unwrap();
}

#[tokio::test]
async fn force_finish_skips_only_broken_repositories_and_delivers_healthy_ones() {
    let f = fixture().await;
    let mut plans = plans(&f).await;
    // Explicitly preserve the healthy checkout so disk ownership is asserted.
    plans[1].delete_worktree = false;
    plans[1].delete_branch = false;
    plans[0].code_action = "skip".into();
    plans[0].delete_worktree = false;
    plans[0].delete_branch = false;
    assert!(
        prepare_batch(&f.state, &f.workspace.id, plans.clone())
            .await
            .is_err()
    );
    let missing = f.repositories[0].checkout_path.as_ref().unwrap();
    std::fs::remove_dir_all(missing).unwrap();
    let initial = prepare_batch(&f.state, &f.workspace.id, plans)
        .await
        .unwrap();
    run_batch(&f.state, initial, false).await.unwrap();
    let completed = saved(&f).await;
    assert_eq!(completed.status, "completed");
    assert_eq!(completed.items[0].status, "skipped");
    assert!(!completed.items[0].delivered);
    assert_eq!(completed.items[1].status, "completed");
    assert_eq!(
        f.state
            .store
            .workspace(&f.workspace.id)
            .await
            .unwrap()
            .status,
        "archived"
    );
    assert_eq!(
        f.state
            .store
            .workspace_repository(&f.repositories[0].id)
            .await
            .unwrap()
            .close_outcome
            .as_deref(),
        Some("skipped")
    );
    assert!(!git(&f.roots[0], &["branch", "--list", "feature/batch"]).is_empty());
    assert_eq!(
        std::fs::read_to_string(f.roots[0].join("shared.txt")).unwrap(),
        "initial\n"
    );
    assert_eq!(
        std::fs::read_to_string(f.roots[1].join("shared.txt")).unwrap(),
        "feature\n"
    );
    assert!(Path::new(f.repositories[1].checkout_path.as_ref().unwrap()).exists());
}

#[tokio::test]
async fn force_finish_can_skip_all_repositories_without_claiming_delivery() {
    let f = fixture().await;
    let mut plans = plans(&f).await;
    for (plan, repository) in plans.iter_mut().zip(&f.repositories) {
        std::fs::remove_dir_all(repository.checkout_path.as_ref().unwrap()).unwrap();
        plan.code_action = "skip".into();
        plan.delete_worktree = false;
        plan.delete_branch = false;
    }
    let initial = prepare_batch(&f.state, &f.workspace.id, plans)
        .await
        .unwrap();
    run_batch(&f.state, initial, false).await.unwrap();
    assert!(
        saved(&f)
            .await
            .items
            .iter()
            .all(|item| item.status == "skipped" && !item.delivered)
    );
    assert_eq!(
        f.state
            .store
            .workspace(&f.workspace.id)
            .await
            .unwrap()
            .status,
        "archived"
    );
}

#[tokio::test]
async fn force_finish_resume_keeps_successful_delivery_and_skips_missing_source() {
    let f = fixture().await;
    let initial = batch(&f).await;
    std::fs::remove_dir_all(f.repositories[1].checkout_path.as_ref().unwrap()).unwrap();
    run_batch(&f.state, initial, false).await.unwrap();
    let paused = saved(&f).await;
    assert!(paused.items[0].delivered);
    let delivered_head = git_head(f.roots[0].to_str().unwrap()).unwrap();
    let Json(_) = force_resume_finish_batch(
        State(f.state.clone()),
        AxumPath(f.workspace.id.clone()),
        ApiJson(SkipRepositories {
            repository_ids: vec![f.repositories[1].id.clone()],
        }),
    )
    .await
    .unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(15), async {
        while workers().lock().await.contains(&f.workspace.id) {
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
    })
    .await
    .unwrap();
    let completed = saved(&f).await;
    assert_eq!(completed.status, "completed");
    assert_eq!(completed.items[1].status, "skipped");
    assert_eq!(
        git_head(f.roots[0].to_str().unwrap()).unwrap(),
        delivered_head
    );
}

#[tokio::test]
async fn force_finish_fork_with_skips_does_not_complete_its_todo() {
    let mut f = fixture().await;
    let parent_id = f.workspace.id.clone();
    f.workspace = fork(&f).await;
    f.repositories = f
        .state
        .store
        .workspace_repositories(&f.workspace.id)
        .await
        .unwrap();
    let mut plans = plans(&f).await;
    std::fs::remove_dir_all(f.repositories[0].checkout_path.as_ref().unwrap()).unwrap();
    plans[0].code_action = "skip".into();
    plans[0].delete_worktree = false;
    plans[0].delete_branch = false;
    let initial = prepare_batch(&f.state, &f.workspace.id, plans)
        .await
        .unwrap();
    run_batch(&f.state, initial, false).await.unwrap();
    assert_eq!(saved(&f).await.status, "completed");
    assert_eq!(
        f.state.store.todos(&parent_id).await.unwrap()[0].status,
        "pending"
    );
}
