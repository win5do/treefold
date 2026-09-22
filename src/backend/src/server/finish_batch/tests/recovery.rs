use super::*;
use crate::server::{workspace_removal::force_delete_workspace, workspace_repository_git_path};

fn assert_code(error: AppError, expected: &str) {
    assert!(
        matches!(&error, AppError::Api { code, .. } if *code == expected),
        "{error:?}"
    );
}
async fn remove(f: &Fixture, id: &str) -> Result<StatusCode> {
    force_delete_workspace(State(f.state.clone()), AxumPath(id.into())).await
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
async fn recovery_delete_requires_structural_failure_and_preserves_disk_and_git() {
    use tower::ServiceExt;
    let f = fixture().await;
    assert_code(
        remove(&f, &f.workspace.id).await.unwrap_err(),
        "FORCE_DELETE_NOT_AVAILABLE",
    );
    let child = fork(&f).await;
    let child_repositories = f
        .state
        .store
        .workspace_repositories(&child.id)
        .await
        .unwrap();
    std::fs::remove_dir_all(f.repositories[0].checkout_path.as_ref().unwrap()).unwrap();
    // A live Finish worker in any child blocks removing the whole tree.
    workers().lock().await.insert(child.id.clone());
    assert_code(
        remove(&f, &f.workspace.id).await.unwrap_err(),
        "FORCE_DELETE_OPERATION_ACTIVE",
    );
    workers().lock().await.remove(&child.id);
    assert!(f.state.store.workspace(&child.id).await.is_ok());
    // Exercise the actual route and middleware, not only the service function.
    let response = crate::server::app(f.state.clone())
        .oneshot(
            axum::http::Request::builder()
                .method("POST")
                .uri(format!("/api/workspaces/{}/force-delete", f.workspace.id))
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert!(f.state.store.workspace(&f.workspace.id).await.is_err());
    assert!(f.state.store.workspace(&child.id).await.is_err());
    assert!(
        f.state
            .store
            .todos(&f.workspace.id)
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        f.state
            .store
            .workspace_repositories(&f.workspace.id)
            .await
            .unwrap()
            .is_empty()
    );
    assert!(Path::new(f.repositories[1].checkout_path.as_ref().unwrap()).exists());
    for repository in child_repositories {
        assert!(Path::new(repository.checkout_path.as_ref().unwrap()).exists());
    }
    for root in &f.roots {
        assert!(!git(root, &["branch", "--list", "feature/batch"]).is_empty());
        assert_eq!(
            std::fs::read_to_string(root.join("shared.txt")).unwrap(),
            "initial\n"
        );
    }
    // No remaining Workspace record blocks Project removal.
    f.state
        .store
        .delete_project(&f.workspace.project_id)
        .await
        .unwrap();
    assert!(f.roots.iter().all(|path| path.exists()));
}

#[tokio::test]
async fn recovery_fork_removal_releases_parent_todo_and_preserves_parent() {
    let f = fixture().await;
    let child = fork(&f).await;
    let repositories = f
        .state
        .store
        .workspace_repositories(&child.id)
        .await
        .unwrap();
    std::fs::remove_dir_all(repositories[0].checkout_path.as_ref().unwrap()).unwrap();
    remove(&f, &child.id).await.unwrap();
    let todos = f.state.store.todos(&f.workspace.id).await.unwrap();
    assert_eq!(todos.len(), 1);
    assert_eq!(todos[0].status, "pending");
    assert!(todos[0].fork_id.is_none());
    assert!(f.state.store.workspace(&f.workspace.id).await.is_ok());
    assert!(Path::new(repositories[1].checkout_path.as_ref().unwrap()).exists());
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
    remove(&f, &f.workspace.id).await.unwrap();
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
async fn recovery_missing_parent_is_not_a_reason_to_delete_healthy_fork() {
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
        remove(&f, &child.id).await.unwrap_err(),
        "FORCE_DELETE_NOT_AVAILABLE",
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
    let rejected = remove(&f, &f.workspace.id).await;
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
    let removed = remove(&f, &f.workspace.id).await;
    // Always clean up the isolated daemon before making assertions.
    f.state.terminals.stop_daemon().await.unwrap();
    assert_code(rejected.unwrap_err(), "FORCE_DELETE_SESSION_ACTIVE");
    stopped.unwrap();
    terminated.unwrap();
    removed.unwrap();
    assert!(f.state.store.session(&session.id).await.is_err());
}
