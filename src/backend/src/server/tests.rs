use super::*;

#[cfg(test)]
mod current_workspace_tests {
    use std::path::{Path, PathBuf};

    use axum::{
        Json,
        body::{Body, to_bytes},
        extract::{Query, State},
        http::{Request, StatusCode},
    };
    use tower::ServiceExt;

    use super::{
        ApiJson, AppState, CloneProjectRepository, CreateDeliveryPreflight, CreateDirectory,
        CreateFork, CreateProject, CreateSession, CreateWorkspace, DeleteProject, FinishWorkspace,
        ParsedGitWorktree, RuntimeDomain, RuntimeHub, UpdateProject, UpdateWorkspaceRepository,
        abort_parent_operation_impl, app, clone_project_repository_impl, close_session,
        command_output, create_delivery_preflight_impl, create_directory, create_fork,
        create_project, create_project_session, create_session, create_workspace,
        create_workspace_repository_preflight_impl, delete_project, delete_project_directory,
        finish_workspace_impl, finish_workspace_repository_impl, get_project, git_head,
        git_is_ancestor, git_worktrees, inspect_project_path_value, managed_repository_source_path,
        normalized_path, parse_git_history, parse_git_worktrees, pull_workspace, push_workspace,
        reconcile_parent_operation, reconcile_process, refresh_project_directory,
        repository_name_from_url, repository_slug, reveal_in_file_manager, slug,
        start_parent_operation_impl, stop_amux, stop_session, undo_parent_operation_impl,
        update_project, update_workspace_repository,
    };
    use crate::{
        model::{Session, Todo},
        settings::SettingsStore,
        store::{Store, now},
        terminal::{TerminalManager, TreefoldProcessView},
    };

    async fn test_state(root: &Path) -> AppState {
        let home = root.join("home");
        AppState {
            store: Store::open(&home.join("data"))
                .await
                .expect("open test Store"),
            keymap: crate::keymap::KeymapStore::open(&home).unwrap(),
            settings: SettingsStore::open(&home).expect("open test Settings"),
            terminals: TerminalManager::default(),
            runtime: RuntimeHub::default(),
            integration: crate::integration::IntegrationManager::test(&home),
        }
    }

    #[tokio::test]
    async fn runtime_hub_uses_instance_scoped_monotonic_cursors_without_setup_gaps() {
        let hub = RuntimeHub::default();
        let other = RuntimeHub::default();
        assert_ne!(hub.cursor().instance_id, other.cursor().instance_id);
        assert_eq!(hub.revision(), 0);

        hub.publish(&[RuntimeDomain::Sidebar], None);
        assert_eq!(hub.revision(), 1);

        let (mut receiver, cursor) = hub.subscribe_with_cursor();
        assert_eq!(cursor.revision, 1);
        hub.publish_session("session-race");
        let change = receiver.recv().await.expect("queued runtime change");
        assert_eq!(change.instance_id, cursor.instance_id);
        assert_eq!(change.revision, 2);
        assert_eq!(
            change.domains,
            vec![
                RuntimeDomain::Sidebar,
                RuntimeDomain::Sessions,
                RuntimeDomain::Processes,
            ]
        );
        assert_eq!(change.session_id.as_deref(), Some("session-race"));
    }

    fn initialize_repository(repository: &Path) {
        std::fs::create_dir_all(repository).expect("create repository");
        command_output(repository, "git", &["init", "-b", "main"]).expect("initialize Git");
        command_output(
            repository,
            "git",
            &["config", "user.email", "treefold@example.test"],
        )
        .expect("configure Git email");
        command_output(repository, "git", &["config", "user.name", "Treefold Test"])
            .expect("configure Git name");
        std::fs::write(repository.join("README.md"), "# fixture\n").expect("write fixture");
        command_output(repository, "git", &["add", "."]).expect("stage fixture");
        command_output(repository, "git", &["commit", "-m", "initial"]).expect("commit fixture");
    }

    #[cfg(unix)]
    #[test]
    fn project_path_inspection_follows_directory_symlinks() {
        use std::os::unix::fs::symlink;

        let root = std::env::temp_dir().join(format!(
            "treefold-project-symlink-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let container = root.join("links");
        let repository = root.join("repository");
        let context = root.join("docs");
        initialize_repository(&repository);
        std::fs::create_dir_all(&container).unwrap();
        std::fs::create_dir_all(&context).unwrap();
        std::fs::write(root.join("file"), "fixture").unwrap();
        symlink("../repository", container.join("repo")).unwrap();
        symlink(&repository, container.join("repo-alias")).unwrap();
        symlink("../docs", container.join("docs")).unwrap();
        symlink("../missing", container.join("broken")).unwrap();
        symlink("../file", container.join("file")).unwrap();
        symlink("loop", container.join("loop")).unwrap();

        let inspected = inspect_project_path_value(container.to_str().unwrap()).unwrap();
        let repository = std::fs::canonicalize(repository).unwrap();
        let context = std::fs::canonicalize(context).unwrap();
        assert_eq!(inspected.candidates.len(), 2);
        let git = inspected
            .candidates
            .iter()
            .find(|item| item.is_git)
            .unwrap();
        assert_eq!(git.path, repository.to_string_lossy());
        assert_eq!(git.repository_root.as_deref(), repository.to_str());
        assert!(inspected.candidates.iter().any(|item| {
            item.path == context.to_string_lossy() && !item.is_git && item.repository_root.is_none()
        }));
        let direct = inspect_project_path_value(container.join("repo").to_str().unwrap()).unwrap();
        assert_eq!(direct.candidates.len(), 1);
        assert_eq!(direct.candidates[0].path, git.path);
        assert!(direct.candidates[0].is_git);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn project_path_inspection_and_creation_keep_selected_locations() {
        let root = std::env::temp_dir().join(format!(
            "treefold-project-path-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let container = root.join("multi-repo");
        let backend = container.join("backend");
        let frontend = container.join("frontend");
        let context = container.join("docs");
        let nested = backend.join("src");
        initialize_repository(&backend);
        initialize_repository(&frontend);
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::create_dir_all(&context).unwrap();
        let backend = std::fs::canonicalize(backend).unwrap();
        let frontend = std::fs::canonicalize(frontend).unwrap();
        let context = std::fs::canonicalize(context).unwrap();
        let nested = std::fs::canonicalize(nested).unwrap();

        let inspected = inspect_project_path_value(container.to_str().unwrap()).unwrap();
        assert_eq!(inspected.candidates.len(), 3);
        assert_eq!(
            inspected
                .candidates
                .iter()
                .filter(|item| item.is_git)
                .count(),
            2
        );
        assert!(
            inspected
                .candidates
                .iter()
                .any(|item| item.path == context.to_string_lossy() && !item.is_git)
        );
        let inside = inspect_project_path_value(nested.to_str().unwrap()).unwrap();
        assert_eq!(inside.candidates.len(), 1);
        assert_eq!(inside.candidates[0].path, nested.to_string_lossy());
        assert_eq!(
            inside.candidates[0].repository_root.as_deref(),
            Some(backend.to_str().unwrap())
        );

        let state = test_state(&root).await;
        let (_, Json(project)) = create_project(
            State(state.clone()),
            ApiJson(CreateProject {
                name: Some("Multi repo".into()),
                description: None,
                path: None,
                locations: Some(vec![
                    nested.to_string_lossy().into_owned(),
                    context.to_string_lossy().into_owned(),
                    frontend.to_string_lossy().into_owned(),
                ]),
                preferred_remote: None,
                default_base_branch: None,
                default_target_branch: None,
                default_delivery_mode: None,
                directory_description: None,
                directory_worktree_setup_command: None,
            }),
        )
        .await
        .unwrap();
        let detail = state.store.project_detail(&project.id).await.unwrap();
        assert_eq!(detail.repositories.len(), 2);
        assert_eq!(detail.directories.len(), 3);
        assert_eq!(
            detail
                .directories
                .iter()
                .find(|item| item.id == project.default_location_id.clone().unwrap())
                .unwrap()
                .path,
            nested.to_string_lossy()
        );
        assert!(
            detail
                .directories
                .iter()
                .any(|item| item.path == context.to_string_lossy() && item.repository_id.is_none())
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn process_snapshot_route_does_not_start_a_missing_daemon() {
        let root = std::env::temp_dir().join(format!(
            "treefold-process-snapshot-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let response = app(test_state(&root).await)
            .oneshot(
                Request::builder()
                    .uri("/api/processes")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .expect("request process snapshot");

        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read response");
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&bytes).unwrap(),
            serde_json::json!([])
        );
    }

    #[tokio::test]
    async fn delete_worktree_preserves_dirty_checkout_and_cleans_stale_registration() {
        let root = std::env::temp_dir().join(format!(
            "treefold-delete-stale-worktree-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let repository = root.join("repository");
        let stale_worktree = root.join("stale-worktree");
        let stale_worktree_path = stale_worktree.to_string_lossy().into_owned();
        initialize_repository(&repository);
        let state = test_state(&root).await;
        let (_, Json(project)) = create_project(
            State(state.clone()),
            ApiJson(CreateProject {
                name: Some("Stale worktree".into()),
                description: None,
                path: Some(repository.to_string_lossy().into_owned()),
                locations: None,
                preferred_remote: None,
                default_base_branch: Some("main".into()),
                default_target_branch: None,
                default_delivery_mode: Some("local_merge".into()),
                directory_description: None,
                directory_worktree_setup_command: None,
            }),
        )
        .await
        .expect("create Project");
        let repository_id = state
            .store
            .repositories(&project.id)
            .await
            .expect("list Project repositories")
            .into_iter()
            .next()
            .expect("Project repository")
            .id;
        command_output(
            &repository,
            "git",
            &[
                "worktree",
                "add",
                "-b",
                "stale-worktree",
                &stale_worktree_path,
            ],
        )
        .expect("create stale worktree");
        std::fs::write(stale_worktree.join("uncommitted.txt"), "keep me\n")
            .expect("create uncommitted worktree file");

        let precheck_response = app(state.clone())
            .oneshot(
                Request::post(format!(
                    "/api/project-repositories/{repository_id}/worktrees/delete-precheck"
                ))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({ "path": stale_worktree_path }).to_string(),
                ))
                .expect("build dirty worktree precheck request"),
            )
            .await
            .expect("precheck dirty worktree");
        assert_eq!(precheck_response.status(), StatusCode::OK);
        let precheck_body = axum::body::to_bytes(precheck_response.into_body(), usize::MAX)
            .await
            .expect("read dirty worktree precheck response");
        let precheck: serde_json::Value = serde_json::from_slice(&precheck_body).unwrap();
        assert_eq!(precheck["status"], "blocked");
        assert_eq!(precheck["tracked_changes"], 0);
        assert_eq!(precheck["untracked_files"], 1);

        let dirty_response = app(state.clone())
            .oneshot(
                Request::delete(format!(
                    "/api/project-repositories/{repository_id}/worktrees"
                ))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({ "path": stale_worktree_path }).to_string(),
                ))
                .expect("build dirty worktree request"),
            )
            .await
            .expect("reject dirty worktree deletion");
        assert_eq!(dirty_response.status(), StatusCode::ACCEPTED);
        let dirty_body = axum::body::to_bytes(dirty_response.into_body(), usize::MAX)
            .await
            .expect("read dirty worktree response");
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&dirty_body).unwrap()["status"],
            "deleting"
        );
        let mut dirty_operation = serde_json::Value::Null;
        for _ in 0..50 {
            let status_response = app(state.clone())
                .oneshot(
                    Request::get(format!(
                        "/api/project-repositories/{repository_id}/worktrees/delete-status?path={stale_worktree_path}"
                    ))
                    .body(Body::empty())
                    .expect("build dirty worktree status request"),
                )
                .await
                .expect("get dirty worktree status");
            let status_body = axum::body::to_bytes(status_response.into_body(), usize::MAX)
                .await
                .expect("read dirty worktree status response");
            dirty_operation = serde_json::from_slice(&status_body).unwrap();
            if dirty_operation["status"] != "deleting" {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        assert_eq!(dirty_operation["status"], "failed");
        assert_eq!(
            dirty_operation["error"],
            "worktree has uncommitted changes; commit, stash, or discard them before deleting it"
        );
        assert!(stale_worktree.join("uncommitted.txt").is_file());

        std::fs::remove_dir_all(&stale_worktree).expect("remove worktree outside Treefold");

        let stale_precheck_response = app(state.clone())
            .oneshot(
                Request::post(format!(
                    "/api/project-repositories/{repository_id}/worktrees/delete-precheck"
                ))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({ "path": stale_worktree_path }).to_string(),
                ))
                .expect("build stale worktree precheck request"),
            )
            .await
            .expect("precheck stale worktree");
        assert_eq!(stale_precheck_response.status(), StatusCode::OK);
        let stale_precheck_body =
            axum::body::to_bytes(stale_precheck_response.into_body(), usize::MAX)
                .await
                .expect("read stale worktree precheck response");
        let stale_precheck: serde_json::Value =
            serde_json::from_slice(&stale_precheck_body).unwrap();
        assert_eq!(stale_precheck["status"], "stale");
        assert_eq!(stale_precheck["directory_exists"], false);

        let response = app(state.clone())
            .oneshot(
                Request::delete(format!(
                    "/api/project-repositories/{repository_id}/worktrees"
                ))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({ "path": stale_worktree_path }).to_string(),
                ))
                .expect("build delete worktree request"),
            )
            .await
            .expect("delete stale worktree registration");

        assert_eq!(response.status(), StatusCode::ACCEPTED);
        let mut stale_operation = serde_json::Value::Null;
        for _ in 0..50 {
            let status_response = app(state.clone())
                .oneshot(
                    Request::get(format!(
                        "/api/project-repositories/{repository_id}/worktrees/delete-status?path={stale_worktree_path}"
                    ))
                    .body(Body::empty())
                    .expect("build stale worktree status request"),
                )
                .await
                .expect("get stale worktree status");
            let status_body = axum::body::to_bytes(status_response.into_body(), usize::MAX)
                .await
                .expect("read stale worktree status response");
            stale_operation = serde_json::from_slice(&status_body).unwrap();
            if stale_operation["status"] != "deleting" {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        assert_eq!(stale_operation["status"], "completed");
        assert!(
            !git_worktrees(&repository.to_string_lossy())
                .expect("list remaining worktrees")
                .iter()
                .any(|worktree| normalized_path(&worktree.path)
                    == normalized_path(&stale_worktree_path))
        );

        drop(state);
        std::fs::remove_dir_all(root).expect("remove stale worktree fixture");
    }

    #[tokio::test]
    async fn monorepo_scopes_share_one_repository_and_one_workspace_worktree() {
        let root = std::env::temp_dir().join(format!(
            "treefold-monorepo-scopes-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let repository = root.join("monorepo");
        initialize_repository(&repository);
        let web = repository.join("apps/web");
        let api = repository.join("services/api");
        std::fs::create_dir_all(&web).expect("create web scope");
        std::fs::create_dir_all(&api).expect("create api scope");
        std::fs::write(web.join("scope.txt"), "web\n").expect("write web scope");
        std::fs::write(api.join("scope.txt"), "api\n").expect("write api scope");
        command_output(&repository, "git", &["add", "."]).expect("stage scopes");
        command_output(&repository, "git", &["commit", "-m", "add scopes"]).expect("commit scopes");
        let state = test_state(&root).await;
        let (_, Json(project)) = create_project(
            State(state.clone()),
            ApiJson(CreateProject {
                name: Some("Monorepo scopes".into()),
                description: None,
                path: Some(web.to_string_lossy().into_owned()),
                locations: None,
                preferred_remote: None,
                default_base_branch: Some("main".into()),
                default_target_branch: None,
                default_delivery_mode: Some("local_merge".into()),
                directory_description: None,
                directory_worktree_setup_command: None,
            }),
        )
        .await
        .expect("create Project from first scope");
        let _ = create_directory(
            State(state.clone()),
            axum::extract::Path(project.id.clone()),
            ApiJson(CreateDirectory {
                path: api.to_string_lossy().into_owned(),
                description: None,
                worktree_setup_command: None,
            }),
        )
        .await
        .expect("add second scope");

        assert_eq!(
            state.store.repositories(&project.id).await.unwrap().len(),
            1
        );
        assert_eq!(
            state
                .store
                .project_directories(&project.id)
                .await
                .unwrap()
                .len(),
            2
        );

        let (_, Json(workspace)) = create_workspace(
            State(state.clone()),
            axum::extract::Path(project.id.clone()),
            ApiJson(CreateWorkspace {
                generated_branch: None,
                description: None,
                branch: None,
                remote_name: None,
                remote_branch: None,
            }),
        )
        .await
        .expect("create one-worktree Workspace");
        assert_eq!(
            state
                .store
                .workspace_repositories(&workspace.id)
                .await
                .unwrap()
                .len(),
            1
        );
        let scopes = state
            .store
            .workspace_directories(&workspace.id)
            .await
            .unwrap();
        assert_eq!(scopes.len(), 2);
        assert!(scopes.iter().all(|scope| Path::new(&scope.path).is_dir()));

        drop(state);
        std::fs::remove_dir_all(root).expect("remove monorepo fixture");
    }

    #[tokio::test]
    async fn discovered_processes_become_idempotent_worktree_command_sessions() {
        let root = std::env::temp_dir().join(format!(
            "treefold-command-discovery-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let repository = root.join("repository");
        initialize_repository(&repository);
        let state = test_state(&root).await;
        let (_, Json(project)) = create_project(
            State(state.clone()),
            ApiJson(CreateProject {
                name: Some("Command Project".into()),
                description: None,
                path: Some(repository.to_string_lossy().into_owned()),
                locations: None,
                preferred_remote: None,
                default_base_branch: None,
                default_target_branch: None,
                default_delivery_mode: None,
                directory_description: None,
                directory_worktree_setup_command: None,
            }),
        )
        .await
        .expect("create command discovery Project");
        let (_, Json(workspace)) = create_workspace(
            State(state.clone()),
            axum::extract::Path(project.id),
            ApiJson(CreateWorkspace {
                generated_branch: None,
                description: None,
                branch: None,
                remote_name: None,
                remote_branch: None,
            }),
        )
        .await
        .expect("create command discovery Workspace");
        let process = TreefoldProcessView {
            id: "proc_generated".into(),
            workspace_id: "amux-internal-workspace".into(),
            group_id: "group".into(),
            parent_process_id: None,
            session_id: None,
            session_root: false,
            workspace_name: TerminalManager::workspace_name(&workspace.checkout_path),
            name: "web-dev-server".into(),
            command: vec!["npm".into(), "run".into(), "dev".into()],
            cwd: workspace.checkout_path.clone(),
            io_mode: "pipe".into(),
            state: "running".into(),
            pid: 4242,
            execution: 1,
            created_at: now(),
            started_at: Some(now()),
            finished_at: None,
            exit_code: None,
            exit_signal: String::new(),
        };
        reconcile_process(&state, &process, false)
            .await
            .expect("discover Command");
        let discovered = state
            .store
            .sessions(&workspace.id)
            .await
            .expect("list discovered Session");
        let first_updated_at = discovered[0].updated_at.clone();
        let first_revision = state.runtime.revision();
        reconcile_process(&state, &process, false)
            .await
            .expect("rediscover Command");
        let sessions = state
            .store
            .sessions(&workspace.id)
            .await
            .expect("list Sessions");
        assert_eq!(
            sessions.len(),
            1,
            "stable amux identity must deduplicate snapshots and events"
        );
        assert_eq!(sessions[0].kind, "command");
        assert_eq!(sessions[0].visibility, "visible");
        assert_eq!(sessions[0].argv, process.command);
        assert_eq!(sessions[0].io_mode, "pipe");
        assert_eq!(sessions[0].updated_at, first_updated_at);
        assert_eq!(state.runtime.revision(), first_revision);

        assert!(!state.terminals.daemon_status().await.running);
        stop_session(
            State(state.clone()),
            axum::extract::Path(sessions[0].id.clone()),
        )
        .await
        .expect("stop without starting a missing daemon");
        assert!(!state.terminals.daemon_status().await.running);
        assert_eq!(
            state.store.session(&sessions[0].id).await.unwrap().status,
            "stopped"
        );
        assert_eq!(state.runtime.revision(), first_revision + 1);

        let mut late_exit = process.clone();
        late_exit.state = "exited".into();
        late_exit.exit_signal = "TERM".into();
        reconcile_process(&state, &late_exit, false)
            .await
            .expect("reconcile late Stop exit");
        assert_eq!(
            state.store.session(&sessions[0].id).await.unwrap().status,
            "stopped"
        );
        assert_eq!(state.runtime.revision(), first_revision + 2);
        let reconciled_revision = state.runtime.revision();
        reconcile_process(&state, &late_exit, false)
            .await
            .expect("repeat late Stop exit");
        assert_eq!(state.runtime.revision(), reconciled_revision);

        reconcile_process(&state, &process, false)
            .await
            .expect("reconcile explicit Restart");
        assert_eq!(
            state.store.session(&sessions[0].id).await.unwrap().status,
            "running"
        );
        let before_daemon_stop = state.runtime.revision();
        let mut runtime_changes = state.runtime.subscribe();
        stop_amux(State(state.clone()))
            .await
            .expect("stop daemon lifecycle");
        assert_eq!(state.runtime.revision(), before_daemon_stop + 1);
        let daemon_change = runtime_changes.recv().await.expect("daemon runtime change");
        assert_eq!(
            daemon_change.domains,
            vec![
                RuntimeDomain::Sidebar,
                RuntimeDomain::Sessions,
                RuntimeDomain::Processes,
                RuntimeDomain::Amux,
            ]
        );
        assert_eq!(
            state.store.session(&sessions[0].id).await.unwrap().status,
            "stopped"
        );
        reconcile_process(&state, &process, true)
            .await
            .expect("remove Command runtime");
        assert_eq!(
            state.store.session(&sessions[0].id).await.unwrap().status,
            "stopped"
        );
        state
            .store
            .delete_session(&sessions[0].id)
            .await
            .expect("close Command Session");
        reconcile_process(&state, &process, true)
            .await
            .expect("ignore late removal after Close");
        assert!(
            state
                .store
                .sessions(&workspace.id)
                .await
                .unwrap()
                .is_empty()
        );
        let mut root_process = process.clone();
        root_process.name = "treefold-root".into();
        root_process.session_root = true;
        root_process.session_id = Some("missing-root-session".into());
        reconcile_process(&state, &root_process, false)
            .await
            .expect("ignore Treefold root");
        assert!(
            state
                .store
                .sessions(&workspace.id)
                .await
                .unwrap()
                .is_empty()
        );
        std::fs::remove_dir_all(root).expect("remove Command discovery fixture");
    }

    #[tokio::test]
    async fn project_requires_a_primary_git_location_before_context_locations() {
        let root = std::env::temp_dir().join(format!(
            "treefold-primary-location-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let repository = root.join("repository");
        let context = root.join("reference-context");
        std::fs::create_dir_all(&context).expect("create context directory");
        let state = test_state(&root).await;

        let error = create_project(
            State(state.clone()),
            ApiJson(CreateProject {
                name: Some("Invalid context Project".into()),
                description: None,
                path: Some(context.to_string_lossy().into_owned()),
                locations: None,
                preferred_remote: None,
                default_base_branch: None,
                default_target_branch: None,
                default_delivery_mode: None,
                directory_description: None,
                directory_worktree_setup_command: None,
            }),
        )
        .await
        .expect_err("a combined Project creation must reject a non-Git first location");
        assert_eq!(
            error.to_string(),
            "a Project's first location must be a ready Git repository"
        );
        assert!(
            state
                .store
                .projects()
                .await
                .expect("list Projects")
                .is_empty()
        );

        let (_, Json(project)) = create_project(
            State(state.clone()),
            ApiJson(CreateProject {
                name: Some("Primary repository Project".into()),
                description: None,
                path: None,
                locations: None,
                preferred_remote: None,
                default_base_branch: None,
                default_target_branch: None,
                default_delivery_mode: None,
                directory_description: None,
                directory_worktree_setup_command: None,
            }),
        )
        .await
        .expect("create empty Project");
        let error = create_directory(
            State(state.clone()),
            axum::extract::Path(project.id.clone()),
            ApiJson(CreateDirectory {
                description: None,
                worktree_setup_command: None,
                path: context.to_string_lossy().into_owned(),
            }),
        )
        .await
        .expect_err("a context location cannot precede the primary Git repository");
        assert_eq!(
            error.to_string(),
            "a Project's first location must be a ready Git repository"
        );

        initialize_repository(&repository);
        let (_, Json(primary)) = create_directory(
            State(state.clone()),
            axum::extract::Path(project.id.clone()),
            ApiJson(CreateDirectory {
                description: None,
                worktree_setup_command: None,
                path: repository.to_string_lossy().into_owned(),
            }),
        )
        .await
        .expect("add primary Git repository");
        assert_eq!(
            state
                .store
                .project(&project.id)
                .await
                .unwrap()
                .default_location_id,
            Some(primary.id.clone())
        );
        assert!(primary.base_branch.is_none());
        assert!(primary.delivery_mode.is_none());
        let error = create_workspace(
            State(state.clone()),
            axum::extract::Path(project.id.clone()),
            ApiJson(CreateWorkspace {
                generated_branch: None,
                description: None,
                branch: None,
                remote_name: None,
                remote_branch: None,
            }),
        )
        .await
        .expect_err("Workspace creation must wait for Project Repository configuration");
        assert_eq!(
            error.to_string(),
            "default Repository delivery mode is not configured"
        );
        state
            .store
            .update_directory(
                &primary.id,
                "Backend source",
                &primary.description,
                &primary.worktree_setup_command,
                primary.base_branch.as_deref(),
                primary.delivery_mode.as_deref(),
            )
            .await
            .unwrap();
        let Json(refreshed) = refresh_project_directory(
            State(state.clone()),
            axum::extract::Path(primary.id.clone()),
        )
        .await
        .expect("refresh renamed Directory");
        assert_eq!(
            refreshed.name, "Backend source",
            "refresh must preserve a user-authored Directory name"
        );

        let _ = create_directory(
            State(state.clone()),
            axum::extract::Path(project.id.clone()),
            ApiJson(CreateDirectory {
                description: None,
                worktree_setup_command: None,
                path: context.to_string_lossy().into_owned(),
            }),
        )
        .await
        .expect("add context after primary Git repository");
        let context_location = state
            .store
            .directories(&project.id)
            .await
            .unwrap()
            .into_iter()
            .find(|location| location.git_status == "not_git")
            .expect("find context location");
        let error = update_project(
            State(state.clone()),
            axum::extract::Path(project.id.clone()),
            ApiJson(UpdateProject {
                name: None,
                description: None,
                status: None,
                default_location_id: Some(context_location.id),
                default_base_branch: None,
                default_delivery_mode: None,
            }),
        )
        .await
        .expect_err("a context location cannot become primary");
        assert_eq!(
            error.to_string(),
            "primary location must be a ready Git repository"
        );
        let error = delete_project_directory(State(state.clone()), axum::extract::Path(primary.id))
            .await
            .expect_err("primary cannot be deleted while other locations remain");
        assert_eq!(
            error.to_string(),
            "choose another default Directory before removing this one"
        );

        std::fs::remove_dir_all(root).expect("remove primary location fixture");
    }

    #[tokio::test]
    async fn project_shell_is_managed_but_deleted_on_close_while_codex_is_retained() {
        let root = std::env::temp_dir().join(format!(
            "treefold-project-session-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let repository = root.join("repository");
        initialize_repository(&repository);
        let state = test_state(&root).await;
        let (_, Json(project)) = create_project(
            State(state.clone()),
            ApiJson(CreateProject {
                name: Some("Managed Project Sessions".into()),
                description: None,
                path: Some(repository.to_string_lossy().into_owned()),
                locations: None,
                preferred_remote: None,
                default_target_branch: Some("main".into()),
                default_base_branch: Some("main".into()),
                default_delivery_mode: Some("local_merge".into()),
                directory_description: None,
                directory_worktree_setup_command: None,
            }),
        )
        .await
        .expect("create Project");
        let (_, Json(shell)) = create_project_session(
            State(state.clone()),
            axum::extract::Path(project.id.clone()),
            ApiJson(CreateSession {
                name: None,
                kind: Some("shell".into()),
                project_directory_id: project.default_location_id.clone(),
                initial_prompt: None,
            }),
        )
        .await
        .expect("create managed Project Shell");
        assert_eq!(
            state
                .store
                .workspace(&shell.workspace_id)
                .await
                .unwrap()
                .kind,
            "base"
        );
        assert_eq!(
            state
                .store
                .project_sessions(&project.id)
                .await
                .unwrap()
                .len(),
            1
        );
        assert!(state.terminals.is_running(&shell.id).await);

        let _ = close_session(State(state.clone()), axum::extract::Path(shell.id.clone()))
            .await
            .expect("close Project Shell");
        assert!(state.store.session(&shell.id).await.is_err());
        assert!(!state.terminals.is_running(&shell.id).await);

        let timestamp = now();
        let codex = Session {
            id: "saved-project-codex".into(),
            workspace_id: shell.workspace_id,
            name: "Saved Project Codex".into(),
            kind: "codex".into(),
            cwd: repository.to_string_lossy().into_owned(),
            original_cwd: repository.to_string_lossy().into_owned(),
            initial_prompt: "Keep this context".into(),
            codex_session_id: Some("codex-session-id".into()),
            visibility: "visible".into(),
            hidden_at: None,
            evicted_at: None,
            amux_workspace_name: TerminalManager::workspace_name(&repository.to_string_lossy()),
            amux_process_name: "saved-project-codex".into(),
            status: "exited".into(),
            exit_code: Some(0),
            exit_signal: String::new(),
            argv: vec!["codex".into()],
            io_mode: "tty".into(),
            launch_started_at: timestamp.clone(),
            last_attached_at: None,
            created_at: timestamp.clone(),
            updated_at: timestamp,
            additional_directories: vec![],
        };
        state.store.create_session(&codex).await.unwrap();
        let _ = close_session(State(state.clone()), axum::extract::Path(codex.id.clone()))
            .await
            .expect("hide saved Project Codex");
        let saved = state
            .store
            .session(&codex.id)
            .await
            .expect("retain Codex history");
        assert_eq!(saved.visibility, "hidden");
        assert_eq!(
            state
                .store
                .project_sessions(&project.id)
                .await
                .unwrap()
                .len(),
            1
        );

        let mut finalized_shell = codex.clone();
        finalized_shell.id = "finalized-shell".into();
        finalized_shell.name = "Finalized Shell".into();
        finalized_shell.kind = "shell".into();
        finalized_shell.codex_session_id = None;
        finalized_shell.visibility = "visible".into();
        finalized_shell.amux_process_name = finalized_shell.id.clone();
        state.store.create_session(&finalized_shell).await.unwrap();
        state
            .store
            .finalize_sessions(&codex.workspace_id, &codex.cwd, true)
            .await
            .expect("finalize Session history");
        assert!(state.store.session(&finalized_shell.id).await.is_err());
        assert_eq!(
            state.store.session(&codex.id).await.unwrap().status,
            "stopped",
            "Codex remains resumable while Shell history is removed"
        );

        let mut pending = codex.clone();
        pending.id = "pending-project-codex".into();
        pending.name = "codex".into();
        pending.amux_process_name = pending.id.clone();
        pending.codex_session_id = None;
        let log_dir = root.join("logs/codex").join(&pending.id);
        std::fs::create_dir_all(&log_dir).unwrap();
        let codex_id = "01a08fff-908b-76b2-8c1c-3826e810b018";
        std::fs::write(
            log_dir.join("codex-tui.log"),
            format!("time INFO session_loop{{thread_id={codex_id}}}: codex_core::session: new\n"),
        )
        .unwrap();
        pending.argv = vec![
            "codex".into(),
            "-c".into(),
            format!(
                "log_dir={}",
                serde_json::to_string(&log_dir.to_string_lossy()).unwrap()
            ),
        ];
        state.store.create_session(&pending).await.unwrap();
        crate::server::capture_codex_session_id(&state.store, &mut pending)
            .await
            .unwrap();
        assert_eq!(
            state
                .store
                .session(&pending.id)
                .await
                .unwrap()
                .codex_session_id
                .as_deref(),
            Some(codex_id)
        );
        assert!(
            state
                .store
                .pending_codex_titles()
                .await
                .unwrap()
                .iter()
                .any(|(id, _)| id == &pending.id)
        );
        assert!(
            !state
                .store
                .import_codex_title(&pending.id, codex_id, " ")
                .await
                .unwrap()
        );
        assert!(
            !state
                .store
                .import_codex_title(&pending.id, "wrong-id", "Wrong title")
                .await
                .unwrap()
        );
        assert!(
            state
                .store
                .import_codex_title(&pending.id, codex_id, "Generated title")
                .await
                .unwrap()
        );
        assert_eq!(
            state.store.session(&pending.id).await.unwrap().name,
            "Generated title"
        );
        assert!(
            !state
                .store
                .import_codex_title(&pending.id, codex_id, "Later Codex title")
                .await
                .unwrap()
        );
        state
            .store
            .rename_session(&pending.id, "codex")
            .await
            .unwrap();
        assert!(
            !state
                .store
                .import_codex_title(&pending.id, codex_id, "Later Codex title")
                .await
                .unwrap()
        );
        assert_eq!(
            state.store.session(&pending.id).await.unwrap().name,
            "codex"
        );
        assert!(
            !state
                .store
                .pending_codex_titles()
                .await
                .unwrap()
                .iter()
                .any(|(id, _)| id == &pending.id)
        );
        assert!(
            !state
                .store
                .import_codex_title(&codex.id, "codex-session-id", "Replace custom name")
                .await
                .unwrap()
        );

        let codex_history = root.join("codex-owned-history.jsonl");
        std::fs::write(&codex_history, "retained conversation").unwrap();
        crate::server::delete_session(
            State(state.clone()),
            axum::extract::Path(pending.id.clone()),
        )
        .await
        .unwrap();
        assert!(state.store.session(&pending.id).await.is_err());
        assert_eq!(
            std::fs::read_to_string(codex_history).unwrap(),
            "retained conversation"
        );

        drop(state);
        std::fs::remove_dir_all(root).expect("remove Project Session fixture");
    }

    #[tokio::test]
    async fn fork_lifecycle_is_local_and_carries_todos_to_parent() {
        let root = std::env::temp_dir().join(format!(
            "treefold-current-fork-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let repository = root.join("repository");
        initialize_repository(&repository);
        let state = test_state(&root).await;

        let (_, Json(project)) = create_project(
            State(state.clone()),
            ApiJson(CreateProject {
                name: Some("Fork lifecycle".into()),
                description: None,
                path: Some(repository.to_string_lossy().into_owned()),
                locations: None,
                preferred_remote: None,
                default_target_branch: Some("main".into()),
                default_base_branch: Some("main".into()),
                default_delivery_mode: Some("local_merge".into()),
                directory_description: None,
                directory_worktree_setup_command: None,
            }),
        )
        .await
        .expect("create Project");
        let (_, Json(workspace)) = create_workspace(
            State(state.clone()),
            axum::extract::Path(project.id.clone()),
            ApiJson(CreateWorkspace {
                generated_branch: Some("feature/current-fork-test".into()),
                description: None,
                branch: None,
                remote_name: None,
                remote_branch: None,
            }),
        )
        .await
        .expect("create Workspace");
        let workspace_location = state
            .store
            .default_workspace_repository(&workspace.id)
            .await
            .unwrap();
        assert_eq!(
            workspace_location.branch.as_deref(),
            Some("feature/current-fork-test")
        );
        assert_eq!(workspace.name, "feature/current-fork-test");
        assert_short_worktree_path(workspace_location.checkout_path.as_deref().unwrap());
        for branch in ["feature/current-fork-test", "invalid branch"] {
            assert!(
                create_fork(
                    State(state.clone()),
                    axum::extract::Path(workspace.id.clone()),
                    ApiJson(CreateFork {
                        generated_branch: Some("main".into()),
                        description: None,
                        branch: Some(branch.into())
                    }),
                )
                .await
                .is_err()
            );
        }
        let sessions = app(state.clone())
            .oneshot(
                Request::get(format!("/api/workspaces/{}/sessions", workspace.id))
                    .body(Body::empty())
                    .expect("build Session list request"),
            )
            .await
            .expect("list Workspace Sessions");
        assert_eq!(sessions.status(), StatusCode::OK);
        let (_, Json(fork)) = create_fork(
            State(state.clone()),
            axum::extract::Path(workspace.id.clone()),
            ApiJson(CreateFork {
                generated_branch: Some("main".into()),
                branch: Some("feature/custom-fork".into()),
                description: Some("Independent task description".into()),
            }),
        )
        .await
        .expect("create Fork");

        assert!(
            create_fork(
                State(state.clone()),
                axum::extract::Path(fork.id.clone()),
                ApiJson(CreateFork {
                    generated_branch: Some("main".into()),
                    branch: None,
                    description: None,
                }),
            )
            .await
            .expect_err("Forks cannot nest")
            .to_string()
            .contains("cannot create another Fork")
        );
        assert!(
            pull_workspace(State(state.clone()), axum::extract::Path(fork.id.clone()))
                .await
                .expect_err("Fork has no Pull")
                .to_string()
                .contains("root Workspace")
        );
        assert!(
            push_workspace(State(state.clone()), axum::extract::Path(fork.id.clone()))
                .await
                .expect_err("Fork has no Push")
                .to_string()
                .contains("no remote branch")
        );
        let fork_location = state
            .store
            .default_workspace_repository(&fork.id)
            .await
            .expect("get Fork location");
        assert_eq!(fork_location.branch.as_deref(), Some("feature/custom-fork"));
        assert_eq!(fork.name, "feature/custom-fork");
        assert_eq!(fork.description, "Independent task description");
        assert_short_worktree_path(fork_location.checkout_path.as_deref().unwrap());
        assert_ne!(
            Path::new(workspace_location.checkout_path.as_deref().unwrap()).parent(),
            Path::new(fork_location.checkout_path.as_deref().unwrap()).parent()
        );
        assert!(
            update_workspace_repository(
                State(state.clone()),
                axum::extract::Path(fork_location.id),
                ApiJson(UpdateWorkspaceRepository {
                    remote_name: None,
                    remote_branch: None,
                }),
            )
            .await
            .expect_err("Fork location has no remote settings")
            .to_string()
            .contains("root Workspace")
        );

        let timestamp = now();
        state
            .store
            .create_todo(&Todo {
                id: "fork-todo".into(),
                workspace_id: workspace.id.clone(),
                content: "Finish parallel work".into(),
                status: "blocked".into(),
                fork_id: Some(fork.id.clone()),
                blocked_reason: Some("waiting".into()),
                created_at: timestamp.clone(),
                updated_at: timestamp,
            })
            .await
            .expect("create Fork Todo");
        let locked_status = app(state.clone())
            .oneshot(
                Request::patch("/api/todos/fork-todo")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"content":"Must not be partially saved","status":"done"}"#,
                    ))
                    .expect("build Todo status request"),
            )
            .await
            .expect("update Todo with active Fork");
        assert_eq!(locked_status.status(), StatusCode::CONFLICT);
        let locked_status_body: serde_json::Value = serde_json::from_slice(
            &axum::body::to_bytes(locked_status.into_body(), usize::MAX)
                .await
                .expect("read locked Todo response"),
        )
        .expect("decode locked Todo response");
        assert_eq!(locked_status_body["error"]["code"], "TODO_FORK_ACTIVE");
        let unchanged = state.store.todo("fork-todo").await.unwrap();
        assert_eq!(unchanged.status, "blocked");
        assert_eq!(unchanged.content, "Finish parallel work");

        let edited_content = app(state.clone())
            .oneshot(
                Request::patch("/api/todos/fork-todo")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"content":"Finish parallel work safely"}"#))
                    .expect("build Todo content request"),
            )
            .await
            .expect("edit Todo content with active Fork");
        assert_eq!(edited_content.status(), StatusCode::OK);
        std::fs::write(
            Path::new(&fork.checkout_path).join("fork.txt"),
            "fork work\n",
        )
        .expect("write Fork change");
        command_output(Path::new(&fork.checkout_path), "git", &["add", "fork.txt"]).unwrap();
        command_output(
            Path::new(&fork.checkout_path),
            "git",
            &["commit", "-m", "finish parallel work"],
        )
        .unwrap();
        let preflight = create_delivery_preflight_impl(
            &state,
            &fork.id,
            &CreateDeliveryPreflight {
                code_action: "local_merge".into(),
            },
        )
        .await
        .expect("create Fork preflight");
        assert!(preflight.blockers.is_empty());
        let finished = finish_workspace_impl(
            &state,
            &fork.id,
            &FinishWorkspace {
                code_action: "local_merge".into(),
                todo_action: "carry".into(),
                push_after_merge: false,
                keep_session_history: true,
                delete_worktree: true,
                delete_branch: true,
                commit_message: Some("finish parallel work".into()),
                preflight_id: Some(preflight.id),
            },
            None,
        )
        .await
        .expect("finish Fork");

        assert_eq!(finished.status, "archived");
        assert!(
            Path::new(&workspace.checkout_path)
                .join("fork.txt")
                .exists()
        );
        assert!(!Path::new(&fork.checkout_path).exists());
        let carried = state
            .store
            .todos(&workspace.id)
            .await
            .expect("parent Todos");
        assert_eq!(carried.len(), 1);
        assert_eq!(carried[0].status, "done");
        assert_eq!(carried[0].fork_id.as_deref(), Some(fork.id.as_str()));
        assert!(carried[0].blocked_reason.is_none());
        assert!(
            command_output(&repository, "git", &["branch", "--list", &fork.branch])
                .expect("list Fork branch")
                .is_empty()
        );

        drop(state);
        std::fs::remove_dir_all(root).expect("remove test fixture");
    }

    #[tokio::test]
    async fn parent_operations_update_integrate_undo_restart_and_abort() {
        let root = std::env::temp_dir().join(format!(
            "treefold-parent-operations-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let repository = root.join("repository");
        initialize_repository(&repository);
        let state = test_state(&root).await;
        let (_, Json(project)) = create_project(
            State(state.clone()),
            ApiJson(CreateProject {
                name: Some("Parent operations".into()),
                description: None,
                path: Some(repository.to_string_lossy().into_owned()),
                locations: None,
                preferred_remote: None,
                default_target_branch: Some("main".into()),
                default_base_branch: Some("main".into()),
                default_delivery_mode: Some("local_merge".into()),
                directory_description: None,
                directory_worktree_setup_command: None,
            }),
        )
        .await
        .expect("create Project");
        let (_, Json(workspace)) = create_workspace(
            State(state.clone()),
            axum::extract::Path(project.id),
            ApiJson(CreateWorkspace {
                generated_branch: None,
                description: None,
                branch: Some("feature/parent-operation-parent".into()),
                remote_name: None,
                remote_branch: None,
            }),
        )
        .await
        .expect("create Workspace");
        let (_, Json(fork)) = create_fork(
            State(state.clone()),
            axum::extract::Path(workspace.id.clone()),
            ApiJson(CreateFork {
                generated_branch: None,
                branch: None,
                description: None,
            }),
        )
        .await
        .expect("create Fork");
        let fork_location = state
            .store
            .default_workspace_repository(&fork.id)
            .await
            .expect("Fork Repository");

        let commit = |path: &str, name: &str, contents: &str, message: &str| {
            std::fs::write(Path::new(path).join(name), contents).expect("write change");
            command_output(Path::new(path), "git", &["add", name]).expect("stage change");
            command_output(Path::new(path), "git", &["commit", "-m", message])
                .expect("commit change");
            git_head(path).expect("read committed HEAD")
        };

        let fork_before = commit(&fork.checkout_path, "fork.txt", "fork\n", "fork change");
        let parent_head = commit(
            &workspace.checkout_path,
            "parent.txt",
            "parent\n",
            "parent change",
        );
        let update = start_parent_operation_impl(
            &state,
            &fork_location.id,
            "update",
            "rebase",
            "standalone",
            None,
        )
        .await
        .expect("rebase Fork from parent");
        assert_eq!(update.status, "completed");
        assert!(update.undo_available);
        assert!(
            git_is_ancestor(
                &fork.checkout_path,
                &parent_head,
                update.result_head.as_deref().expect("updated HEAD")
            )
            .expect("parent is ancestor")
        );
        let undone_update = undo_parent_operation_impl(&state, &update)
            .await
            .expect("undo update");
        assert_eq!(undone_update.status, "undone");
        assert_eq!(git_head(&fork.checkout_path).unwrap(), fork_before);

        let integration = start_parent_operation_impl(
            &state,
            &fork_location.id,
            "integrate",
            "merge",
            "standalone",
            None,
        )
        .await
        .expect("integrate Fork into parent");
        assert_eq!(integration.status, "completed");
        let integrated_head = integration
            .result_head
            .as_deref()
            .expect("integration HEAD");
        assert!(git_is_ancestor(&workspace.checkout_path, &fork_before, integrated_head).unwrap());
        assert!(git_is_ancestor(&workspace.checkout_path, &parent_head, integrated_head).unwrap());
        let parents = command_output(
            Path::new(&workspace.checkout_path),
            "git",
            &["show", "-s", "--format=%P", integrated_head],
        )
        .expect("read merge parents");
        assert_eq!(parents.split_whitespace().count(), 2);
        undo_parent_operation_impl(&state, &integration)
            .await
            .expect("undo integration");
        assert_eq!(git_head(&workspace.checkout_path).unwrap(), parent_head);

        commit(
            &fork.checkout_path,
            "conflict.txt",
            "child\n",
            "child conflict",
        );
        commit(
            &workspace.checkout_path,
            "conflict.txt",
            "parent\n",
            "parent conflict",
        );
        let conflicted = start_parent_operation_impl(
            &state,
            &fork_location.id,
            "update",
            "merge",
            "standalone",
            None,
        )
        .await
        .expect("start conflicted update");
        assert_eq!(conflicted.status, "conflicted");
        let restarted = AppState {
            store: Store::open(&root.join("home/data"))
                .await
                .expect("reopen Store"),
            keymap: crate::keymap::KeymapStore::open(&root.join("home")).unwrap(),
            settings: SettingsStore::open(&root.join("home")).expect("reopen Settings"),
            terminals: TerminalManager::default(),
            runtime: RuntimeHub::default(),
            integration: crate::integration::IntegrationManager::test(&root.join("home")),
        };
        let recovered = reconcile_parent_operation(&restarted, &conflicted)
            .await
            .expect("reconcile after restart");
        assert_eq!(recovered.status, "conflicted");
        let aborted = abort_parent_operation_impl(&restarted, &recovered)
            .await
            .expect("abort update");
        assert_eq!(aborted.status, "aborted");
        assert_eq!(
            git_head(&fork.checkout_path).unwrap(),
            conflicted.before_head
        );

        let workspace_repository = state
            .store
            .default_workspace_repository(&workspace.id)
            .await
            .expect("root Workspace Repository");
        let project_before = git_head(repository.to_str().unwrap()).unwrap();
        let root_integration = start_parent_operation_impl(
            &state,
            &workspace_repository.id,
            "integrate",
            "merge",
            "standalone",
            None,
        )
        .await
        .expect("integrate root Workspace into Project");
        assert_eq!(root_integration.status, "completed");
        assert_eq!(
            git_head(repository.to_str().unwrap()).unwrap(),
            root_integration.result_head.clone().unwrap()
        );
        let root_undone = undo_parent_operation_impl(&state, &root_integration)
            .await
            .expect("undo root integration");
        assert_eq!(root_undone.status, "undone");
        assert_eq!(
            git_head(repository.to_str().unwrap()).unwrap(),
            project_before
        );

        drop(restarted);
        drop(state);
        std::fs::remove_dir_all(root).expect("remove parent-operation fixture");
    }

    #[tokio::test]
    async fn finish_local_merge_pauses_for_conflict_and_requires_resume() {
        let root = std::env::temp_dir().join(format!(
            "treefold-finish-parent-operation-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let repository = root.join("repository");
        initialize_repository(&repository);
        let state = test_state(&root).await;
        let (_, Json(project)) = create_project(
            State(state.clone()),
            ApiJson(CreateProject {
                name: Some("Finish conflict".into()),
                description: None,
                path: Some(repository.to_string_lossy().into_owned()),
                locations: None,
                preferred_remote: None,
                default_target_branch: Some("main".into()),
                default_base_branch: Some("main".into()),
                default_delivery_mode: Some("local_merge".into()),
                directory_description: None,
                directory_worktree_setup_command: None,
            }),
        )
        .await
        .unwrap();
        let (_, Json(workspace)) = create_workspace(
            State(state.clone()),
            axum::extract::Path(project.id),
            ApiJson(CreateWorkspace {
                generated_branch: None,
                description: None,
                branch: Some("feature/finish-parent".into()),
                remote_name: None,
                remote_branch: None,
            }),
        )
        .await
        .unwrap();
        let (_, Json(fork)) = create_fork(
            State(state.clone()),
            axum::extract::Path(workspace.id),
            ApiJson(CreateFork {
                generated_branch: None,
                branch: None,
                description: None,
            }),
        )
        .await
        .unwrap();
        let fork_location = state
            .store
            .default_workspace_repository(&fork.id)
            .await
            .unwrap();
        for (path, contents, message) in [
            (&fork.checkout_path, "child\n", "child conflict"),
            (&workspace.checkout_path, "parent\n", "parent conflict"),
        ] {
            std::fs::write(Path::new(path).join("shared.txt"), contents).unwrap();
            command_output(Path::new(path), "git", &["add", "shared.txt"]).unwrap();
            command_output(Path::new(path), "git", &["commit", "-m", message]).unwrap();
        }
        let (_, Json(preflight)) = create_workspace_repository_preflight_impl(
            state.clone(),
            fork_location.id.clone(),
            CreateDeliveryPreflight {
                code_action: "local_merge".into(),
            },
        )
        .await
        .expect("create conflict Finish preflight");
        let input = FinishWorkspace {
            code_action: "local_merge".into(),
            todo_action: "carry".into(),
            push_after_merge: false,
            keep_session_history: true,
            delete_worktree: false,
            delete_branch: false,
            commit_message: None,
            preflight_id: Some(preflight.id),
        };
        let Json(paused) = finish_workspace_repository_impl(
            state.clone(),
            fork_location.id.clone(),
            input.clone(),
        )
        .await
        .expect("pause Finish on conflict");
        assert_eq!(paused.status, "paused");
        let operation = paused.operation.expect("linked integration");
        assert_eq!(operation.status, "conflicted");

        std::fs::write(
            Path::new(&workspace.checkout_path).join("shared.txt"),
            "resolved\n",
        )
        .unwrap();
        command_output(
            Path::new(&workspace.checkout_path),
            "git",
            &["add", "shared.txt"],
        )
        .unwrap();
        command_output(
            Path::new(&workspace.checkout_path),
            "git",
            &["-c", "core.editor=true", "merge", "--continue"],
        )
        .unwrap();
        let completed = reconcile_parent_operation(&state, &operation)
            .await
            .unwrap();
        assert_eq!(completed.status, "completed");
        assert!(!completed.undo_available);

        let Json(finished) =
            finish_workspace_repository_impl(state.clone(), fork_location.id, input)
                .await
                .expect("continue Finish after conflict resolution");
        assert_eq!(finished.status, "finished");
        assert_eq!(finished.repository.delivery_status, "delivered");
        assert!(
            !state
                .store
                .parent_operation(&completed.id)
                .await
                .unwrap()
                .undo_available
        );

        drop(state);
        std::fs::remove_dir_all(root).expect("remove Finish conflict fixture");
    }

    #[tokio::test]
    async fn finish_preflight_blocks_dirty_workspace_without_committing() {
        let root = std::env::temp_dir().join(format!(
            "treefold-finish-dirty-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let repository = root.join("repository");
        initialize_repository(&repository);
        let state = test_state(&root).await;
        let (_, Json(project)) = create_project(
            State(state.clone()),
            ApiJson(CreateProject {
                name: Some("Dirty Finish".into()),
                description: None,
                path: Some(repository.to_string_lossy().into_owned()),
                locations: None,
                preferred_remote: None,
                default_target_branch: Some("main".into()),
                default_base_branch: Some("main".into()),
                default_delivery_mode: Some("push_branch".into()),
                directory_description: None,
                directory_worktree_setup_command: None,
            }),
        )
        .await
        .unwrap();
        let (_, Json(workspace)) = create_workspace(
            State(state.clone()),
            axum::extract::Path(project.id),
            ApiJson(CreateWorkspace {
                generated_branch: None,
                description: None,
                branch: Some("feature/dirty-finish".into()),
                remote_name: None,
                remote_branch: None,
            }),
        )
        .await
        .unwrap();
        std::fs::write(
            Path::new(&workspace.checkout_path).join("dirty.txt"),
            "dirty\n",
        )
        .unwrap();
        let location = state
            .store
            .default_workspace_repository(&workspace.id)
            .await
            .unwrap();
        let (_, Json(preflight)) = create_workspace_repository_preflight_impl(
            state.clone(),
            location.id.clone(),
            CreateDeliveryPreflight {
                code_action: "keep".into(),
            },
        )
        .await
        .unwrap();
        assert!(
            preflight
                .blockers
                .iter()
                .any(|item| item.contains("uncommitted changes"))
        );
        let error = finish_workspace_repository_impl(
            state.clone(),
            location.id,
            FinishWorkspace {
                code_action: "keep".into(),
                todo_action: "".into(),
                push_after_merge: false,
                keep_session_history: true,
                delete_worktree: false,
                delete_branch: false,
                commit_message: None,
                preflight_id: Some(preflight.id),
            },
        )
        .await
        .expect_err("dirty Finish must be blocked");
        assert!(error.to_string().contains("preflight is blocked"));
        assert!(
            Path::new(&workspace.checkout_path)
                .join("dirty.txt")
                .is_file()
        );
        drop(state);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn finish_push_branch_publishes_feature_branch_without_merging_base() {
        let root = std::env::temp_dir().join(format!(
            "treefold-finish-push-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let repository = root.join("repository");
        let remote = root.join("remote.git");
        initialize_repository(&repository);
        let base_head = git_head(repository.to_str().unwrap()).unwrap();
        std::fs::create_dir_all(&remote).unwrap();
        command_output(&remote, "git", &["init", "--bare"]).unwrap();
        command_output(
            &repository,
            "git",
            &["remote", "add", "origin", remote.to_string_lossy().as_ref()],
        )
        .unwrap();
        let state = test_state(&root).await;
        let (_, Json(project)) = create_project(
            State(state.clone()),
            ApiJson(CreateProject {
                name: Some("Push Finish".into()),
                description: None,
                path: Some(repository.to_string_lossy().into_owned()),
                locations: None,
                preferred_remote: Some("origin".into()),
                default_target_branch: Some("main".into()),
                default_base_branch: Some("main".into()),
                default_delivery_mode: Some("push_branch".into()),
                directory_description: None,
                directory_worktree_setup_command: None,
            }),
        )
        .await
        .unwrap();
        let (_, Json(workspace)) = create_workspace(
            State(state.clone()),
            axum::extract::Path(project.id),
            ApiJson(CreateWorkspace {
                generated_branch: None,
                description: None,
                branch: Some("feature/publish-finish".into()),
                remote_name: Some("origin".into()),
                remote_branch: Some("feature/publish-finish".into()),
            }),
        )
        .await
        .unwrap();
        let location = state
            .store
            .default_workspace_repository(&workspace.id)
            .await
            .unwrap();
        let (_, Json(preflight)) = create_workspace_repository_preflight_impl(
            state.clone(),
            location.id.clone(),
            CreateDeliveryPreflight {
                code_action: "push_branch".into(),
            },
        )
        .await
        .unwrap();
        assert!(preflight.blockers.is_empty(), "{:#?}", preflight.blockers);
        let Json(finished) = finish_workspace_repository_impl(
            state.clone(),
            location.id.clone(),
            FinishWorkspace {
                code_action: "push_branch".into(),
                todo_action: "".into(),
                push_after_merge: false,
                keep_session_history: true,
                delete_worktree: false,
                delete_branch: false,
                commit_message: None,
                preflight_id: Some(preflight.id),
            },
        )
        .await
        .unwrap();
        assert_eq!(finished.repository.delivery_status, "pushed");
        assert_eq!(
            finished.repository.close_outcome.as_deref(),
            Some("push_branch")
        );
        let remote_head = command_output(
            &repository,
            "git",
            &[
                "--git-dir",
                remote.to_string_lossy().as_ref(),
                "rev-parse",
                "refs/heads/feature/publish-finish",
            ],
        )
        .unwrap();
        assert_eq!(remote_head, git_head(&workspace.checkout_path).unwrap());
        assert_eq!(git_head(repository.to_str().unwrap()).unwrap(), base_head);
        drop(state);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn workspace_snapshots_all_git_and_read_only_locations() {
        let root = std::env::temp_dir().join(format!(
            "treefold-multi-location-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let first = root.join("repo-z-primary");
        let second = root.join("repo-a-second");
        let context = root.join("reference-third");
        initialize_repository(&first);
        initialize_repository(&second);
        std::fs::create_dir_all(&context).expect("create context");
        let state = test_state(&root).await;
        let (_, Json(project)) = create_project(
            State(state.clone()),
            ApiJson(CreateProject {
                name: Some("Multi location".into()),
                description: None,
                path: None,
                locations: None,
                preferred_remote: None,
                default_base_branch: Some("main".into()),
                default_target_branch: None,
                default_delivery_mode: Some("local_merge".into()),
                directory_description: None,
                directory_worktree_setup_command: None,
            }),
        )
        .await
        .expect("create empty Project");
        let mut ids = Vec::new();
        for path in [&first, &second, &context] {
            let (_, Json(location)) = create_directory(
                State(state.clone()),
                axum::extract::Path(project.id.clone()),
                ApiJson(CreateDirectory {
                    description: None,
                    worktree_setup_command: None,
                    path: path.to_string_lossy().into_owned(),
                }),
            )
            .await
            .expect("create Project location");
            if location.git_common_dir.is_some() {
                state
                    .store
                    .update_directory(
                        &location.id,
                        &location.name,
                        "",
                        "",
                        Some("main"),
                        Some("local_merge"),
                    )
                    .await
                    .expect("configure Project Repository");
            }
            ids.push(location.id);
        }
        assert_eq!(
            state
                .store
                .directories(&project.id)
                .await
                .expect("list ordered Project locations")
                .iter()
                .map(|location| location.name.as_str())
                .collect::<Vec<_>>(),
            vec!["repo-z-primary", "repo-a-second", "reference-third"],
            "the primary location stays first and the rest keep insertion order"
        );
        state
            .store
            .update_project_defaults(&project.id, Some(&ids[1]), "main", "local_merge")
            .await
            .expect("switch primary location");
        assert_eq!(
            state
                .store
                .directories(&project.id)
                .await
                .expect("list reordered Project locations")
                .iter()
                .map(|location| location.name.as_str())
                .collect::<Vec<_>>(),
            vec!["repo-a-second", "repo-z-primary", "reference-third"],
            "switching primary moves only that location to the front"
        );
        let (_, Json(workspace)) = create_workspace(
            State(state.clone()),
            axum::extract::Path(project.id.clone()),
            ApiJson(CreateWorkspace {
                generated_branch: Some("main".into()),
                description: None,
                branch: None,
                remote_name: None,
                remote_branch: None,
            }),
        )
        .await
        .expect("create multi-location Workspace");
        let location = state
            .store
            .default_workspace_repository(&workspace.id)
            .await
            .unwrap();
        assert_short_worktree_path(location.checkout_path.as_deref().unwrap());
        assert_eq!(workspace.name, location.branch.as_deref().unwrap());
        let branch = location
            .branch
            .as_deref()
            .unwrap()
            .strip_prefix("treefold/")
            .unwrap();
        let parts = branch.split('-').collect::<Vec<_>>();
        assert_eq!(parts.len(), 3);
        assert_eq!(parts[0].len(), 6);
        assert_eq!(parts[1].len(), 4);
        assert!(
            parts[..2]
                .iter()
                .all(|part| part.bytes().all(|byte| byte.is_ascii_digit()))
        );
        assert_eq!(parts[2].len(), 4);
        assert!(parts[2].bytes().all(|byte| byte.is_ascii_hexdigit()));

        let repositories = state
            .store
            .workspace_repositories(&workspace.id)
            .await
            .expect("list Workspace repositories");
        assert_eq!(repositories.len(), 2);
        assert!(
            repositories
                .iter()
                .all(|item| item.delivery_mode == "local_merge")
        );
        assert_eq!(
            repositories[0].branch, repositories[1].branch,
            "all repositories share one branch name"
        );
        assert!(repositories.iter().all(|item| {
            item.checkout_path
                .as_deref()
                .is_some_and(|path| Path::new(path).is_dir())
        }));
        let directories = state
            .store
            .workspace_directories(&workspace.id)
            .await
            .expect("list Workspace Directory snapshots");
        assert_eq!(directories.len(), 3);
        assert_eq!(
            directories
                .iter()
                .filter(|item| item.access_mode == "read_only")
                .count(),
            1
        );
        let project_directory = state.store.directory(&ids[2]).await.unwrap();
        state
            .store
            .update_directory(
                &project_directory.id,
                "Renamed reference",
                &project_directory.description,
                &project_directory.worktree_setup_command,
                None,
                None,
            )
            .await
            .unwrap();
        assert_eq!(
            state
                .store
                .workspace_directories(&workspace.id)
                .await
                .unwrap()
                .into_iter()
                .find(|item| item.project_directory_id == ids[2])
                .unwrap()
                .name,
            "reference-third",
            "existing Workspace Directory names remain immutable snapshots"
        );
        let Json(project_detail) = get_project(
            State(state.clone()),
            axum::extract::Path(project.id.clone()),
        )
        .await
        .expect("get Project worktrees");
        let associated_worktrees = project_detail
            .worktrees
            .iter()
            .filter(|item| item.workspace_id.as_deref() == Some(workspace.id.as_str()))
            .collect::<Vec<_>>();
        assert_eq!(
            associated_worktrees.len(),
            repositories.len(),
            "every writable repository worktree must be associated with the Workspace"
        );
        assert!(repositories.iter().all(|location| {
            associated_worktrees
                .iter()
                .any(|worktree| worktree.project_repository_id == location.project_repository_id)
        }));
        let Json(updated_location) = update_workspace_repository(
            State(state.clone()),
            axum::extract::Path(repositories[0].id.clone()),
            ApiJson(UpdateWorkspaceRepository {
                remote_name: None,
                remote_branch: None,
            }),
        )
        .await
        .expect("clear Workspace Repository upstream");
        assert_eq!(updated_location.delivery_mode, "local_merge");
        assert!(updated_location.remote_name.is_none());
        assert!(updated_location.remote_branch.is_none());
        command_output(&context, "git", &["init", "-b", "main"]).expect("turn context into Git");
        command_output(
            &context,
            "git",
            &["config", "user.email", "treefold@example.test"],
        )
        .unwrap();
        command_output(&context, "git", &["config", "user.name", "Treefold Test"]).unwrap();
        std::fs::write(context.join("README.md"), "context\n").unwrap();
        command_output(&context, "git", &["add", "."]).unwrap();
        command_output(&context, "git", &["commit", "-m", "initial"]).unwrap();
        let Json(refreshed) =
            refresh_project_directory(State(state.clone()), axum::extract::Path(ids[2].clone()))
                .await
                .expect("refresh promoted location");
        assert_eq!(refreshed.git_status, "ready");
        assert_eq!(
            state
                .store
                .workspace_directories(&workspace.id)
                .await
                .unwrap()
                .iter()
                .find(|item| item.project_directory_id == ids[2])
                .unwrap()
                .access_mode,
            "read_only",
            "existing Workspace snapshot must not change"
        );
        std::fs::remove_dir_all(root).expect("remove fixture");
    }

    #[tokio::test]
    async fn multi_location_setup_runs_in_a_visible_shell_without_blocking_creation() {
        let root = std::env::temp_dir().join(format!(
            "treefold-location-setup-shell-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let first = root.join("repo-a");
        let second = root.join("repo-z");
        initialize_repository(&first);
        initialize_repository(&second);
        let state = test_state(&root).await;
        let (_, Json(project)) = create_project(
            State(state.clone()),
            ApiJson(CreateProject {
                name: Some("Setup shell".into()),
                description: None,
                path: Some(first.to_string_lossy().into_owned()),
                locations: None,
                preferred_remote: None,
                default_base_branch: Some("main".into()),
                default_target_branch: None,
                default_delivery_mode: Some("local_merge".into()),
                directory_description: None,
                directory_worktree_setup_command: None,
            }),
        )
        .await
        .unwrap();
        let (_, Json(second_location)) = create_directory(
            State(state.clone()),
            axum::extract::Path(project.id.clone()),
            ApiJson(CreateDirectory {
                description: None,
                worktree_setup_command: Some("exit 7".into()),
                path: second.to_string_lossy().into_owned(),
            }),
        )
        .await
        .unwrap();
        state
            .store
            .update_directory(
                &second_location.id,
                &second_location.name,
                "",
                "exit 7",
                Some("main"),
                Some("local_merge"),
            )
            .await
            .expect("configure second Project Repository");
        let (_, Json(workspace)) = create_workspace(
            State(state.clone()),
            axum::extract::Path(project.id.clone()),
            ApiJson(CreateWorkspace {
                generated_branch: None,
                description: None,
                branch: None,
                remote_name: None,
                remote_branch: None,
            }),
        )
        .await
        .expect("setup command must not block Workspace creation");
        assert_eq!(state.store.workspaces(&project.id).await.unwrap().len(), 1);
        assert_eq!(
            super::git_worktrees(first.to_str().unwrap()).unwrap().len(),
            2
        );
        assert_eq!(
            super::git_worktrees(second.to_str().unwrap())
                .unwrap()
                .len(),
            2
        );
        let mut setup_shell = None;
        for _ in 0..100 {
            setup_shell = state
                .store
                .sessions(&workspace.id)
                .await
                .unwrap()
                .into_iter()
                .find(|session| {
                    session.name == "setup · repo-z"
                        && session.argv.iter().any(|value| value == "-lc")
                });
            if setup_shell.is_some() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        let setup_shell = setup_shell.expect("create a visible setup Shell");
        let second_repository_id = state
            .store
            .directory_record(&second_location.id)
            .await
            .unwrap()
            .repository_id
            .unwrap();
        assert_eq!(setup_shell.kind, "shell");
        assert!(setup_shell.initial_prompt.ends_with("&& exit 7"));
        assert_eq!(
            setup_shell.cwd,
            state
                .store
                .workspace_repositories(&workspace.id)
                .await
                .unwrap()
                .into_iter()
                .find(|location| { location.project_repository_id == second_repository_id })
                .unwrap()
                .checkout_path
                .unwrap()
        );
        assert!(setup_shell.argv.iter().any(|value| value == "-lc"));
        assert!(state.terminals.is_running(&setup_shell.id).await);

        let _ = close_session(State(state.clone()), axum::extract::Path(setup_shell.id))
            .await
            .expect("close setup Shell");
        for location in state
            .store
            .workspace_repositories(&workspace.id)
            .await
            .unwrap()
        {
            if let Some(checkout_path) = location.checkout_path {
                let repository = state
                    .store
                    .repository(&location.project_repository_id)
                    .await
                    .unwrap()
                    .source_root;
                command_output(
                    Path::new(&repository),
                    "git",
                    &["worktree", "remove", "--force", &checkout_path],
                )
                .expect("remove test worktree");
            }
        }
        drop(state);
        std::fs::remove_dir_all(root).expect("remove fixture");
    }

    #[tokio::test]
    async fn failed_location_is_retained_without_rolling_back_successful_worktrees() {
        let root = std::env::temp_dir().join(format!(
            "treefold-location-partial-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let first = root.join("repo-a");
        let second = root.join("repo-z");
        initialize_repository(&first);
        initialize_repository(&second);
        let state = test_state(&root).await;
        let (_, Json(project)) = create_project(
            State(state.clone()),
            ApiJson(CreateProject {
                name: Some("Partial Workspace".into()),
                description: None,
                path: Some(first.to_string_lossy().into_owned()),
                locations: None,
                preferred_remote: None,
                default_base_branch: Some("main".into()),
                default_target_branch: None,
                default_delivery_mode: Some("local_merge".into()),
                directory_description: None,
                directory_worktree_setup_command: None,
            }),
        )
        .await
        .unwrap();
        let (_, Json(second_location)) = create_directory(
            State(state.clone()),
            axum::extract::Path(project.id.clone()),
            ApiJson(CreateDirectory {
                description: None,
                worktree_setup_command: None,
                path: second.to_string_lossy().into_owned(),
            }),
        )
        .await
        .unwrap();
        state
            .store
            .update_directory(
                &second_location.id,
                &second_location.name,
                "",
                "",
                Some("missing-base"),
                Some("local_merge"),
            )
            .await
            .unwrap();
        state
            .store
            .update_project_defaults(
                &project.id,
                Some(&second_location.id),
                "main",
                "local_merge",
            )
            .await
            .unwrap();

        let (_, Json(workspace)) = create_workspace(
            State(state.clone()),
            axum::extract::Path(project.id.clone()),
            ApiJson(CreateWorkspace {
                generated_branch: Some("main".into()),
                description: None,
                branch: None,
                remote_name: None,
                remote_branch: None,
            }),
        )
        .await
        .expect("retain a partially created Workspace");
        let second_repository_id = state
            .store
            .directory_record(&second_location.id)
            .await
            .unwrap()
            .repository_id
            .unwrap();
        let repositories = state
            .store
            .workspace_repositories(&workspace.id)
            .await
            .unwrap();
        let failed = repositories
            .iter()
            .find(|repository| repository.project_repository_id == second_repository_id)
            .unwrap();
        assert_eq!(failed.git_status, "failed");
        assert_eq!(failed.delivery_status, "discarded");
        assert!(failed.checkout_path.is_none());
        assert!(
            failed
                .creation_error
                .as_deref()
                .unwrap()
                .contains("missing-base")
        );
        assert_eq!(
            repositories
                .iter()
                .filter(|location| location.git_status == "ready")
                .count(),
            1
        );
        assert_eq!(
            super::git_worktrees(first.to_str().unwrap()).unwrap().len(),
            2
        );
        assert_eq!(
            super::git_worktrees(second.to_str().unwrap())
                .unwrap()
                .len(),
            1
        );

        let ready = repositories
            .into_iter()
            .find(|location| location.git_status == "ready")
            .unwrap();
        assert_eq!(
            workspace.checkout_path,
            ready.checkout_path.as_deref().unwrap()
        );
        let (_, Json(codex)) = create_session(
            State(state.clone()),
            axum::extract::Path(workspace.id.clone()),
            ApiJson(CreateSession {
                name: Some("Fallback Codex".into()),
                kind: Some("codex".into()),
                project_directory_id: None,
                initial_prompt: None,
            }),
        )
        .await
        .expect("fall back to the successful non-default worktree");
        assert_eq!(codex.cwd, ready.checkout_path.as_deref().unwrap());
        let _ = close_session(State(state.clone()), axum::extract::Path(codex.id))
            .await
            .expect("close fallback Codex");
        let (_, Json(fork)) = create_fork(
            State(state.clone()),
            axum::extract::Path(workspace.id.clone()),
            ApiJson(CreateFork {
                generated_branch: Some("main".into()),
                branch: None,
                description: None,
            }),
        )
        .await
        .expect("retain the same partial location set in a Fork");
        let fork_locations = state.store.workspace_repositories(&fork.id).await.unwrap();
        assert_eq!(
            fork_locations
                .iter()
                .filter(|location| location.git_status == "ready")
                .count(),
            1
        );
        assert_eq!(
            fork_locations
                .iter()
                .filter(|location| location.git_status == "failed")
                .count(),
            1
        );
        let fork_ready = fork_locations
            .into_iter()
            .find(|location| location.git_status == "ready")
            .unwrap();
        command_output(
            &first,
            "git",
            &[
                "worktree",
                "remove",
                "--force",
                fork_ready.checkout_path.as_deref().unwrap(),
            ],
        )
        .expect("remove successful Fork test worktree");
        command_output(
            &first,
            "git",
            &[
                "worktree",
                "remove",
                "--force",
                ready.checkout_path.as_deref().unwrap(),
            ],
        )
        .expect("remove successful test worktree");
        drop(state);
        std::fs::remove_dir_all(root).expect("remove fixture");
    }

    #[test]
    fn creation_requests_allow_empty_payloads() {
        let workspace: CreateWorkspace = serde_json::from_str("{}").unwrap();
        assert!(workspace.branch.is_none());
        assert!(workspace.description.is_none());
        let fork: CreateFork = serde_json::from_str("{}").unwrap();
        assert!(fork.branch.is_none());
        assert!(fork.description.is_none());
    }

    fn assert_short_worktree_path(path: &str) {
        let namespace = Path::new(path)
            .parent()
            .unwrap()
            .file_name()
            .unwrap()
            .to_str()
            .unwrap();
        assert_eq!(namespace.len(), 16);
        assert_eq!(&namespace[6..7], "-");
        assert_eq!(&namespace[11..12], "-");
        assert!(
            namespace[..6]
                .bytes()
                .chain(namespace[7..11].bytes())
                .all(|byte| byte.is_ascii_digit())
        );
        assert!(
            namespace[12..]
                .bytes()
                .all(|byte| byte.is_ascii_lowercase())
        );
    }

    #[test]
    fn managed_git_paths_are_short_and_ascii_safe() {
        let root =
            std::env::temp_dir().join(format!("treefold-path-test-{}", uuid::Uuid::new_v4()));
        let home = root.join("home");
        let settings = SettingsStore::open(&home).expect("open test Settings");
        let expected_home = settings.treefold_home().to_path_buf();

        assert_eq!(
            managed_repository_source_path(&settings, "PROJECT-ID", "Repo 中文 @ Name"),
            expected_home.join("git/s/project-id/repo-name")
        );
        assert_eq!(repository_slug("中文仓库"), "repository");

        drop(settings);
        std::fs::remove_dir_all(root).expect("remove fixture");
    }

    #[tokio::test]
    async fn project_delete_cleans_managed_clone_and_worktree_but_preserves_external_origin() {
        let root = std::env::temp_dir().join(format!(
            "treefold-source-path-test-{}",
            uuid::Uuid::new_v4()
        ));
        let origin = root.join("origin");
        initialize_repository(&origin);
        let state = test_state(&root).await;
        let (_, Json(project)) = create_project(
            State(state.clone()),
            ApiJson(CreateProject {
                name: Some("Managed source".into()),
                description: None,
                path: None,
                locations: None,
                preferred_remote: None,
                default_base_branch: Some("main".into()),
                default_target_branch: None,
                default_delivery_mode: None,
                directory_description: None,
                directory_worktree_setup_command: None,
            }),
        )
        .await
        .expect("create empty Project");
        let (_, Json(directory)) = clone_project_repository_impl(
            state.clone(),
            project.id.clone(),
            CloneProjectRepository {
                url: origin.to_string_lossy().into_owned(),
                name: Some("Repo 中文 @ Name".into()),
                preferred_remote_name: None,
                setup_command: None,
            },
        )
        .await
        .expect("clone managed Repository");

        assert_eq!(
            Path::new(&directory.path),
            state
                .settings
                .treefold_home()
                .join("git/s")
                .join(&project.id)
                .join("repo-name")
        );
        let repository_id = state
            .store
            .directory_repository_id(&directory.id)
            .await
            .expect("read cloned Repository id")
            .expect("cloned Directory belongs to a Repository");
        let repository = state.store.repository(&repository_id).await.unwrap();
        assert_eq!(repository.source_ownership, "managed");
        state
            .store
            .update_repository(&repository_id, "", ".", "main", "keep")
            .await
            .expect("configure cloned Repository");
        let (_, Json(workspace)) = create_workspace(
            State(state.clone()),
            axum::extract::Path(project.id.clone()),
            ApiJson(CreateWorkspace {
                generated_branch: None,
                description: None,
                branch: None,
                remote_name: None,
                remote_branch: None,
            }),
        )
        .await
        .expect("create managed worktree");
        let managed_source = PathBuf::from(&directory.path);
        let managed_worktree = PathBuf::from(&workspace.checkout_path);
        assert!(managed_source.exists());
        assert!(managed_worktree.exists());
        state
            .store
            .finish_workspace(&workspace.id, "kept", "kept", None, &now())
            .await
            .expect("archive retained Workspace");
        state
            .store
            .update_project_status(&project.id, "archived")
            .await
            .expect("archive Project");
        delete_project(
            State(state.clone()),
            axum::extract::Path(project.id),
            Query(DeleteProject {
                cleanup_managed: true,
            }),
        )
        .await
        .expect("delete Project with managed cleanup");

        assert!(!managed_worktree.exists());
        assert!(!managed_source.exists());
        assert!(origin.exists(), "external clone origin must be preserved");

        drop(state);
        std::fs::remove_dir_all(root).expect("remove fixture");
    }

    #[test]
    fn derives_repository_names_from_common_git_urls() {
        assert_eq!(
            repository_name_from_url("https://example.com/org/My-Repo.git"),
            "My-Repo"
        );
        assert_eq!(
            repository_name_from_url("git@example.com:org/My-Repo.git"),
            "My-Repo"
        );
    }
    #[test]
    fn slug_is_safe_for_worktree_paths() {
        assert_eq!(slug("Desktop Migration / Rust"), "desktop-migration-rust");
        assert_eq!(slug("你好"), "workspace");
        assert!(slug(&"a".repeat(80)).len() <= 32);
    }

    #[test]
    fn parses_git_worktree_porcelain_output() {
        let output = "worktree /repo\nHEAD 1234567890abcdef\nbranch refs/heads/main\n\nworktree /repo-feature\nHEAD abcdef1234567890\ndetached";
        assert_eq!(
            parse_git_worktrees(output),
            vec![
                ParsedGitWorktree {
                    path: "/repo".into(),
                    branch: "main".into(),
                    head_commit: "1234567890".into(),
                    is_main: true,
                },
                ParsedGitWorktree {
                    path: "/repo-feature".into(),
                    branch: "detached HEAD".into(),
                    head_commit: "abcdef1234".into(),
                    is_main: false,
                },
            ]
        );
    }

    #[test]
    fn parses_git_history_records() {
        let output = "f5377ee123456789\x1ff5377ee\x1fwin5do\x1f2026-08-07T11:17:00+08:00\x1fReplace Makefile with Justfile\x1e\n3cddb0b123456789\x1f3cddb0b\x1fwin5do\x1f2026-08-07T10:42:00+08:00\x1fReimplement amux runtime in Rust\x1e";
        let commits = parse_git_history(output);
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].short_hash, "f5377ee");
        assert_eq!(commits[0].subject, "Replace Makefile with Justfile");
        assert_eq!(commits[1].author, "win5do");
        assert_eq!(commits[1].authored_at, "2026-08-07T10:42:00+08:00");
    }

    #[test]
    fn reveal_rejects_a_missing_path() {
        let path =
            std::env::temp_dir().join(format!("treefold-missing-reveal-{}", uuid::Uuid::new_v4()));
        assert!(reveal_in_file_manager(&path.to_string_lossy()).is_err());
    }

    async fn agent_api_fixture() -> (PathBuf, AppState, Session, Session) {
        let root =
            std::env::temp_dir().join(format!("treefold-agent-api-test-{}", uuid::Uuid::new_v4()));
        let repository = root.join("repository");
        initialize_repository(&repository);
        let state = test_state(&root).await;
        let (_, Json(project)) = create_project(
            State(state.clone()),
            ApiJson(CreateProject {
                name: Some("Agent API".into()),
                description: None,
                path: Some(repository.to_string_lossy().into_owned()),
                locations: None,
                preferred_remote: None,
                default_target_branch: None,
                default_base_branch: Some("main".into()),
                default_delivery_mode: Some("local_merge".into()),
                directory_description: None,
                directory_worktree_setup_command: None,
            }),
        )
        .await
        .expect("create agent API Project");
        let (_, Json(workspace)) = create_workspace(
            State(state.clone()),
            axum::extract::Path(project.id),
            ApiJson(CreateWorkspace {
                generated_branch: None,
                description: None,
                branch: None,
                remote_name: None,
                remote_branch: None,
            }),
        )
        .await
        .expect("create agent API Workspace");
        let make_session = |name: &str| {
            let timestamp = now();
            Session {
                id: uuid::Uuid::new_v4().simple().to_string(),
                workspace_id: workspace.id.clone(),
                name: name.into(),
                kind: "codex".into(),
                cwd: workspace.checkout_path.clone(),
                original_cwd: workspace.checkout_path.clone(),
                initial_prompt: String::new(),
                codex_session_id: None,
                visibility: "visible".into(),
                hidden_at: None,
                evicted_at: None,
                amux_workspace_name: TerminalManager::workspace_name(&workspace.checkout_path),
                amux_process_name: format!("session-{name}"),
                status: "running".into(),
                exit_code: None,
                exit_signal: String::new(),
                argv: vec![],
                io_mode: "tty".into(),
                launch_started_at: timestamp.clone(),
                last_attached_at: None,
                created_at: timestamp.clone(),
                updated_at: timestamp,
                additional_directories: vec![],
            }
        };
        let first = make_session("first");
        let second = make_session("second");
        state
            .store
            .create_session(&first)
            .await
            .expect("create first Session");
        state
            .store
            .create_session(&second)
            .await
            .expect("create second Session");
        (root, state, first, second)
    }

    fn agent_request(
        method: &str,
        path: &str,
        session: Option<&Session>,
        body: Option<serde_json::Value>,
    ) -> Request<Body> {
        let mut request = Request::builder().method(method).uri(path);
        if let Some(session) = session {
            request = request.header("authorization", format!("Bearer {}", session.id));
        }
        if body.is_some() {
            request = request.header("content-type", "application/json");
        }
        request
            .body(Body::from(
                body.map_or_else(String::new, |value| value.to_string()),
            ))
            .expect("build agent API request")
    }

    #[tokio::test]
    async fn agent_api_requires_session_capability_and_returns_current_context() {
        let (root, state, first, _) = agent_api_fixture().await;
        let router = app(state.clone());
        let unauthorized = router
            .clone()
            .oneshot(agent_request("GET", "/api/v1/agent/current", None, None))
            .await
            .expect("request unauthorized context");
        assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);

        let response = router
            .oneshot(agent_request(
                "GET",
                "/api/v1/agent/current",
                Some(&first),
                None,
            ))
            .await
            .expect("request current context");
        assert_eq!(response.status(), StatusCode::OK);
        let value: serde_json::Value = serde_json::from_slice(
            &to_bytes(response.into_body(), usize::MAX)
                .await
                .expect("read current context"),
        )
        .expect("decode current context");
        assert_eq!(value["session"]["id"], first.id);
        assert_eq!(value["session"]["cwd"], first.cwd);
        assert_eq!(value["working_directory"]["path"], first.cwd);
        assert_eq!(value["workspace"]["locations"][0]["path"], first.cwd);
        assert_eq!(value["runtime"]["type"], "amux");
        assert!(
            value["runtime"]["workspace"]
                .as_str()
                .is_some_and(|name| name.starts_with("treefold-ws-"))
        );
        drop(state);
        std::fs::remove_dir_all(root).expect("remove agent API fixture");
    }

    #[tokio::test]
    async fn agent_todo_api_supports_markdown_crud_and_blocking() {
        let (root, state, first, second) = agent_api_fixture().await;
        let router = app(state.clone());
        let created = router
            .clone()
            .oneshot(agent_request(
                "POST",
                "/api/v1/agent/todos",
                Some(&first),
                Some(serde_json::json!({"content":"Implement CLI\n\nMVP"})),
            ))
            .await
            .expect("create Todo");
        assert_eq!(created.status(), StatusCode::CREATED);
        let created: serde_json::Value = serde_json::from_slice(
            &to_bytes(created.into_body(), usize::MAX)
                .await
                .expect("read created Todo"),
        )
        .expect("decode created Todo");
        let todo_id = created["id"].as_str().expect("created Todo ID");

        let listed = router
            .clone()
            .oneshot(agent_request(
                "GET",
                "/api/v1/agent/todos",
                Some(&first),
                None,
            ))
            .await
            .expect("list Todos");
        let listed: serde_json::Value = serde_json::from_slice(
            &to_bytes(listed.into_body(), usize::MAX)
                .await
                .expect("read Todo list"),
        )
        .expect("decode Todo list");
        assert_eq!(listed.as_array().expect("Todo list").len(), 1);

        let edited = router
            .clone()
            .oneshot(agent_request(
                "PATCH",
                &format!("/api/v1/agent/todos/{todo_id}"),
                Some(&first),
                Some(serde_json::json!({"content":"Implement Treefold CLI"})),
            ))
            .await
            .expect("edit Todo");
        assert_eq!(edited.status(), StatusCode::OK);

        let blocked = router
            .clone()
            .oneshot(agent_request(
                "POST",
                &format!("/api/v1/agent/todos/{todo_id}/block"),
                Some(&second),
                Some(serde_json::json!({"reason":"missing fixture"})),
            ))
            .await
            .expect("block Todo");
        assert_eq!(blocked.status(), StatusCode::OK);
        let blocked: serde_json::Value = serde_json::from_slice(
            &to_bytes(blocked.into_body(), usize::MAX)
                .await
                .expect("read blocked Todo"),
        )
        .expect("decode blocked Todo");
        assert_eq!(blocked["blocked_reason"], "missing fixture");

        let shown = router
            .clone()
            .oneshot(agent_request(
                "GET",
                &format!("/api/v1/agent/todos/{todo_id}"),
                Some(&first),
                None,
            ))
            .await
            .expect("show completed Todo");
        let shown: serde_json::Value = serde_json::from_slice(
            &to_bytes(shown.into_body(), usize::MAX)
                .await
                .expect("read completed Todo"),
        )
        .expect("decode completed Todo");
        assert_eq!(shown["content"], "Implement Treefold CLI");
        assert_eq!(shown["status"], "blocked");
        assert_eq!(shown["blocked_reason"], "missing fixture");

        let removed = router
            .oneshot(agent_request(
                "DELETE",
                &format!("/api/v1/agent/todos/{todo_id}"),
                Some(&first),
                None,
            ))
            .await
            .expect("remove Todo");
        assert_eq!(removed.status(), StatusCode::OK);
        assert!(matches!(
            state.store.todo(todo_id).await,
            Err(crate::error::AppError::NotFound)
        ));
        drop(state);
        std::fs::remove_dir_all(root).expect("remove agent Todo fixture");
    }
}
