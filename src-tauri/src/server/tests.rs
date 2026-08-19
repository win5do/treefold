use super::*;

#[cfg(test)]
mod current_workspace_tests {
    use std::path::Path;

    use axum::{
        Json,
        body::Body,
        extract::State,
        http::{Request, StatusCode},
    };
    use tower::ServiceExt;

    use super::{
        ApiJson, AppState, CreateDeliveryPreflight, CreateDirectory, CreateFork, CreateProject,
        CreateSession, CreateWorkspace, FinishWorkspace, RuntimeHub, UpdateProject,
        UpdateWorkspaceLocation, abort_parent_operation_impl, app, close_session, command_output,
        create_delivery_preflight_impl, create_directory, create_fork, create_project,
        create_project_session, create_session, create_workspace,
        create_workspace_location_preflight_impl, delete_project_location, finish_workspace_impl,
        finish_workspace_location_impl, get_project, git_head, git_is_ancestor, git_worktrees,
        normalized_path, pull_workspace, push_workspace, reconcile_parent_operation,
        reconcile_process, refresh_project_location, start_parent_operation_impl, stop_session,
        undo_parent_operation_impl, update_project, update_workspace_location,
    };
    use crate::{
        model::{Session, Todo},
        settings::SettingsStore,
        store::{Store, now},
        terminal::{TerminalManager, TreefoldProcessView},
    };

    fn test_state(root: &Path) -> AppState {
        let home = root.join("home");
        AppState {
            store: Store::open(&home.join("data/treefold.db")).expect("open test Store"),
            settings: SettingsStore::open(&home).expect("open test Settings"),
            terminals: TerminalManager::default(),
            runtime: RuntimeHub::default(),
        }
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

    #[tokio::test]
    async fn process_snapshot_route_does_not_start_a_missing_daemon() {
        let root = std::env::temp_dir().join(format!(
            "treefold-process-snapshot-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let response = app(test_state(&root))
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
        let state = test_state(&root);
        let (_, Json(project)) = create_project(
            State(state.clone()),
            ApiJson(CreateProject {
                name: Some("Stale worktree".into()),
                description: None,
                path: Some(repository.to_string_lossy().into_owned()),
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
        let state = test_state(&root);
        let (_, Json(project)) = create_project(
            State(state.clone()),
            ApiJson(CreateProject {
                name: Some("Monorepo scopes".into()),
                description: None,
                path: Some(web.to_string_lossy().into_owned()),
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
                base_branch: None,
                delivery_mode: None,
            }),
        )
        .await
        .expect("add second scope");

        assert_eq!(state.store.repositories(&project.id).unwrap().len(), 1);
        assert_eq!(
            state.store.project_directories(&project.id).unwrap().len(),
            2
        );

        let (_, Json(workspace)) = create_workspace(
            State(state.clone()),
            axum::extract::Path(project.id.clone()),
            ApiJson(CreateWorkspace {
                name: "Scoped change".into(),
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
                .unwrap()
                .len(),
            1
        );
        let scopes = state.store.workspace_directories(&workspace.id).unwrap();
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
        let state = test_state(&root);
        let (_, Json(project)) = create_project(
            State(state.clone()),
            ApiJson(CreateProject {
                name: Some("Command Project".into()),
                description: None,
                path: Some(repository.to_string_lossy().into_owned()),
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
                name: "Command Workspace".into(),
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
        reconcile_process(&state, &process, false).expect("discover Command");
        let discovered = state
            .store
            .sessions(&workspace.id)
            .expect("list discovered Session");
        let first_updated_at = discovered[0].updated_at.clone();
        let first_revision = state.runtime.revision();
        reconcile_process(&state, &process, false).expect("rediscover Command");
        let sessions = state.store.sessions(&workspace.id).expect("list Sessions");
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
            state.store.session(&sessions[0].id).unwrap().status,
            "stopped"
        );

        let mut late_exit = process.clone();
        late_exit.state = "exited".into();
        late_exit.exit_signal = "TERM".into();
        reconcile_process(&state, &late_exit, false).expect("reconcile late Stop exit");
        assert_eq!(
            state.store.session(&sessions[0].id).unwrap().status,
            "stopped"
        );

        reconcile_process(&state, &process, false).expect("reconcile explicit Restart");
        assert_eq!(
            state.store.session(&sessions[0].id).unwrap().status,
            "running"
        );
        reconcile_process(&state, &process, true).expect("remove Command runtime");
        assert_eq!(
            state.store.session(&sessions[0].id).unwrap().status,
            "stopped"
        );
        state
            .store
            .delete_session(&sessions[0].id)
            .expect("close Command Session");
        reconcile_process(&state, &process, true).expect("ignore late removal after Close");
        assert!(state.store.sessions(&workspace.id).unwrap().is_empty());
        let mut root_process = process.clone();
        root_process.name = "treefold-root".into();
        root_process.session_root = true;
        root_process.session_id = Some("missing-root-session".into());
        reconcile_process(&state, &root_process, false).expect("ignore Treefold root");
        assert!(state.store.sessions(&workspace.id).unwrap().is_empty());
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
        let state = test_state(&root);

        let error = create_project(
            State(state.clone()),
            ApiJson(CreateProject {
                name: Some("Invalid context Project".into()),
                description: None,
                path: Some(context.to_string_lossy().into_owned()),
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
        assert!(state.store.projects().expect("list Projects").is_empty());

        let (_, Json(project)) = create_project(
            State(state.clone()),
            ApiJson(CreateProject {
                name: Some("Primary repository Project".into()),
                description: None,
                path: None,
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
                base_branch: None,
                delivery_mode: None,
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
                base_branch: Some("main".into()),
                delivery_mode: Some("local_merge".into()),
            }),
        )
        .await
        .expect("add primary Git repository");
        assert_eq!(
            state
                .store
                .project(&project.id)
                .unwrap()
                .default_location_id,
            Some(primary.id.clone())
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
            .unwrap();
        let Json(refreshed) = refresh_project_location(
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
                base_branch: None,
                delivery_mode: None,
            }),
        )
        .await
        .expect("add context after primary Git repository");
        let context_location = state
            .store
            .directories(&project.id)
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
        let error = delete_project_location(State(state.clone()), axum::extract::Path(primary.id))
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
        let state = test_state(&root);
        let (_, Json(project)) = create_project(
            State(state.clone()),
            ApiJson(CreateProject {
                name: Some("Managed Project Sessions".into()),
                description: None,
                path: Some(repository.to_string_lossy().into_owned()),
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
            state.store.workspace(&shell.workspace_id).unwrap().kind,
            "base"
        );
        assert_eq!(state.store.project_sessions(&project.id).unwrap().len(), 1);
        assert!(state.terminals.is_running(&shell.id).await);

        let _ = close_session(State(state.clone()), axum::extract::Path(shell.id.clone()))
            .await
            .expect("close Project Shell");
        assert!(state.store.session(&shell.id).is_err());
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
        state.store.create_session(&codex).unwrap();
        let _ = close_session(State(state.clone()), axum::extract::Path(codex.id.clone()))
            .await
            .expect("hide saved Project Codex");
        let saved = state
            .store
            .session(&codex.id)
            .expect("retain Codex history");
        assert_eq!(saved.visibility, "hidden");
        assert_eq!(state.store.project_sessions(&project.id).unwrap().len(), 1);

        let mut finalized_shell = codex.clone();
        finalized_shell.id = "finalized-shell".into();
        finalized_shell.name = "Finalized Shell".into();
        finalized_shell.kind = "shell".into();
        finalized_shell.codex_session_id = None;
        finalized_shell.visibility = "visible".into();
        finalized_shell.amux_process_name = finalized_shell.id.clone();
        state.store.create_session(&finalized_shell).unwrap();
        state
            .store
            .finalize_sessions(&codex.workspace_id, &codex.cwd, true)
            .expect("finalize Session history");
        assert!(state.store.session(&finalized_shell.id).is_err());
        assert_eq!(
            state.store.session(&codex.id).unwrap().status,
            "stopped",
            "Codex remains resumable while Shell history is removed"
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
        let state = test_state(&root);

        let (_, Json(project)) = create_project(
            State(state.clone()),
            ApiJson(CreateProject {
                name: Some("Fork lifecycle".into()),
                description: None,
                path: Some(repository.to_string_lossy().into_owned()),
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
                name: "Feature".into(),
                description: None,
                branch: Some("feature/current-fork-test".into()),
                remote_name: None,
                remote_branch: None,
            }),
        )
        .await
        .expect("create Workspace");
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
                name: "Parallel work".into(),
                description: None,
            }),
        )
        .await
        .expect("create Fork");

        assert!(
            create_fork(
                State(state.clone()),
                axum::extract::Path(fork.id.clone()),
                ApiJson(CreateFork {
                    name: "Nested".into(),
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
            .default_workspace_location(&fork.id)
            .expect("get Fork location");
        assert!(
            update_workspace_location(
                State(state.clone()),
                axum::extract::Path(fork_location.id),
                ApiJson(UpdateWorkspaceLocation {
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
        let unchanged = state.store.todo("fork-todo").unwrap();
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
                resume_finish: false,
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
        let carried = state.store.todos(&workspace.id).expect("parent Todos");
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
        let state = test_state(&root);
        let (_, Json(project)) = create_project(
            State(state.clone()),
            ApiJson(CreateProject {
                name: Some("Parent operations".into()),
                description: None,
                path: Some(repository.to_string_lossy().into_owned()),
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
                name: "Parent".into(),
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
                name: "Child".into(),
                description: None,
            }),
        )
        .await
        .expect("create Fork");
        let fork_location = state
            .store
            .default_workspace_location(&fork.id)
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
        let undone_update = undo_parent_operation_impl(&state, &update).expect("undo update");
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
        undo_parent_operation_impl(&state, &integration).expect("undo integration");
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
        .expect("start conflicted update");
        assert_eq!(conflicted.status, "conflicted");
        let restarted = AppState {
            store: Store::open(&root.join("home/data/treefold.db")).expect("reopen Store"),
            settings: SettingsStore::open(&root.join("home")).expect("reopen Settings"),
            terminals: TerminalManager::default(),
            runtime: RuntimeHub::default(),
        };
        let recovered =
            reconcile_parent_operation(&restarted, &conflicted).expect("reconcile after restart");
        assert_eq!(recovered.status, "conflicted");
        let aborted = abort_parent_operation_impl(&restarted, &recovered).expect("abort update");
        assert_eq!(aborted.status, "aborted");
        assert_eq!(
            git_head(&fork.checkout_path).unwrap(),
            conflicted.before_head
        );

        let workspace_location = state
            .store
            .default_workspace_location(&workspace.id)
            .expect("root Workspace Repository");
        let project_before = git_head(repository.to_str().unwrap()).unwrap();
        let root_integration = start_parent_operation_impl(
            &state,
            &workspace_location.id,
            "integrate",
            "merge",
            "standalone",
            None,
        )
        .expect("integrate root Workspace into Project");
        assert_eq!(root_integration.status, "completed");
        assert_eq!(
            git_head(repository.to_str().unwrap()).unwrap(),
            root_integration.result_head.clone().unwrap()
        );
        let root_undone =
            undo_parent_operation_impl(&state, &root_integration).expect("undo root integration");
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
        let state = test_state(&root);
        let (_, Json(project)) = create_project(
            State(state.clone()),
            ApiJson(CreateProject {
                name: Some("Finish conflict".into()),
                description: None,
                path: Some(repository.to_string_lossy().into_owned()),
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
                name: "Parent".into(),
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
                name: "Finish child".into(),
                description: None,
            }),
        )
        .await
        .unwrap();
        let fork_location = state.store.default_workspace_location(&fork.id).unwrap();
        for (path, contents, message) in [
            (&fork.checkout_path, "child\n", "child conflict"),
            (&workspace.checkout_path, "parent\n", "parent conflict"),
        ] {
            std::fs::write(Path::new(path).join("shared.txt"), contents).unwrap();
            command_output(Path::new(path), "git", &["add", "shared.txt"]).unwrap();
            command_output(Path::new(path), "git", &["commit", "-m", message]).unwrap();
        }
        let (_, Json(preflight)) = create_workspace_location_preflight_impl(
            state.clone(),
            fork_location.id.clone(),
            CreateDeliveryPreflight {
                code_action: "local_merge".into(),
            },
        )
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
            resume_finish: false,
        };
        let Json(paused) =
            finish_workspace_location_impl(state.clone(), fork_location.id.clone(), input.clone())
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
        let completed = reconcile_parent_operation(&state, &operation).unwrap();
        assert_eq!(completed.status, "completed");
        assert!(completed.undo_available);

        let Json(awaiting) =
            finish_workspace_location_impl(state.clone(), fork_location.id.clone(), input.clone())
                .expect("wait for explicit Resume Finish");
        assert_eq!(awaiting.status, "awaiting_resume");
        let mut resume = input;
        resume.resume_finish = true;
        let Json(finished) =
            finish_workspace_location_impl(state.clone(), fork_location.id, resume)
                .expect("resume Finish");
        assert_eq!(finished.status, "finished");
        assert_eq!(finished.location.delivery_status, "delivered");
        assert!(
            !state
                .store
                .parent_operation(&completed.id)
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
        let state = test_state(&root);
        let (_, Json(project)) = create_project(
            State(state.clone()),
            ApiJson(CreateProject {
                name: Some("Dirty Finish".into()),
                description: None,
                path: Some(repository.to_string_lossy().into_owned()),
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
                name: "Dirty Workspace".into(),
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
            .default_workspace_location(&workspace.id)
            .unwrap();
        let (_, Json(preflight)) = create_workspace_location_preflight_impl(
            state.clone(),
            location.id.clone(),
            CreateDeliveryPreflight {
                code_action: "keep".into(),
            },
        )
        .unwrap();
        assert!(
            preflight
                .blockers
                .iter()
                .any(|item| item.contains("uncommitted changes"))
        );
        let error = finish_workspace_location_impl(
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
                resume_finish: false,
            },
        )
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
        let state = test_state(&root);
        let (_, Json(project)) = create_project(
            State(state.clone()),
            ApiJson(CreateProject {
                name: Some("Push Finish".into()),
                description: None,
                path: Some(repository.to_string_lossy().into_owned()),
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
                name: "Publish Workspace".into(),
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
            .default_workspace_location(&workspace.id)
            .unwrap();
        let (_, Json(preflight)) = create_workspace_location_preflight_impl(
            state.clone(),
            location.id.clone(),
            CreateDeliveryPreflight {
                code_action: "push_branch".into(),
            },
        )
        .unwrap();
        assert!(preflight.blockers.is_empty(), "{:#?}", preflight.blockers);
        let Json(finished) = finish_workspace_location_impl(
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
                resume_finish: false,
            },
        )
        .unwrap();
        assert_eq!(finished.location.delivery_status, "pushed");
        assert_eq!(
            finished.location.close_outcome.as_deref(),
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
        let state = test_state(&root);
        let (_, Json(project)) = create_project(
            State(state.clone()),
            ApiJson(CreateProject {
                name: Some("Multi location".into()),
                description: None,
                path: None,
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
                    base_branch: path.join(".git").exists().then(|| "main".into()),
                    delivery_mode: path.join(".git").exists().then(|| "local_merge".into()),
                }),
            )
            .await
            .expect("create Project location");
            ids.push(location.id);
        }
        assert_eq!(
            state
                .store
                .directories(&project.id)
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
            .expect("switch primary location");
        assert_eq!(
            state
                .store
                .directories(&project.id)
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
                name: "Coordinated change".into(),
                description: None,
                branch: None,
                remote_name: None,
                remote_branch: None,
            }),
        )
        .await
        .expect("create multi-location Workspace");
        let repositories = state
            .store
            .workspace_locations(&workspace.id)
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
            .expect("list Workspace Directory snapshots");
        assert_eq!(directories.len(), 3);
        assert_eq!(
            directories
                .iter()
                .filter(|item| item.access_mode == "read_only")
                .count(),
            1
        );
        let project_directory = state.store.directory(&ids[2]).unwrap();
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
            .unwrap();
        assert_eq!(
            state
                .store
                .workspace_directories(&workspace.id)
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
                .any(|worktree| worktree.project_location_id == location.project_location_id)
        }));
        let Json(updated_location) = update_workspace_location(
            State(state.clone()),
            axum::extract::Path(repositories[0].id.clone()),
            ApiJson(UpdateWorkspaceLocation {
                remote_name: None,
                remote_branch: None,
            }),
        )
        .await
        .expect("clear Workspace location upstream");
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
            refresh_project_location(State(state.clone()), axum::extract::Path(ids[2].clone()))
                .await
                .expect("refresh promoted location");
        assert_eq!(refreshed.git_status, "ready");
        assert_eq!(
            state
                .store
                .workspace_directories(&workspace.id)
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
        let state = test_state(&root);
        let (_, Json(project)) = create_project(
            State(state.clone()),
            ApiJson(CreateProject {
                name: Some("Setup shell".into()),
                description: None,
                path: Some(first.to_string_lossy().into_owned()),
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
                base_branch: Some("main".into()),
                delivery_mode: Some("local_merge".into()),
            }),
        )
        .await
        .unwrap();
        let (_, Json(workspace)) = create_workspace(
            State(state.clone()),
            axum::extract::Path(project.id.clone()),
            ApiJson(CreateWorkspace {
                name: "Keep setup output".into(),
                description: None,
                branch: None,
                remote_name: None,
                remote_branch: None,
            }),
        )
        .await
        .expect("setup command must not block Workspace creation");
        assert_eq!(state.store.workspaces(&project.id).unwrap().len(), 1);
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
        assert_eq!(setup_shell.kind, "shell");
        assert!(setup_shell.initial_prompt.ends_with("&& exit 7"));
        assert_eq!(
            setup_shell.cwd,
            state
                .store
                .workspace_locations(&workspace.id)
                .unwrap()
                .into_iter()
                .find(|location| {
                    location.project_location_id
                        == state
                            .store
                            .directory_record(&second_location.id)
                            .unwrap()
                            .repository_id
                            .unwrap()
                })
                .unwrap()
                .checkout_path
                .unwrap()
        );
        assert!(setup_shell.argv.iter().any(|value| value == "-lc"));
        assert!(state.terminals.is_running(&setup_shell.id).await);

        let _ = close_session(State(state.clone()), axum::extract::Path(setup_shell.id))
            .await
            .expect("close setup Shell");
        for location in state.store.workspace_locations(&workspace.id).unwrap() {
            if let Some(checkout_path) = location.checkout_path {
                let repository = state
                    .store
                    .repository(&location.project_location_id)
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
        let state = test_state(&root);
        let (_, Json(project)) = create_project(
            State(state.clone()),
            ApiJson(CreateProject {
                name: Some("Partial Workspace".into()),
                description: None,
                path: Some(first.to_string_lossy().into_owned()),
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
                base_branch: Some("main".into()),
                delivery_mode: Some("local_merge".into()),
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
            .unwrap();
        state
            .store
            .update_project_defaults(
                &project.id,
                Some(&second_location.id),
                "main",
                "local_merge",
            )
            .unwrap();

        let (_, Json(workspace)) = create_workspace(
            State(state.clone()),
            axum::extract::Path(project.id.clone()),
            ApiJson(CreateWorkspace {
                name: "Partial result".into(),
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
            .unwrap()
            .repository_id
            .unwrap();
        let repositories = state.store.workspace_locations(&workspace.id).unwrap();
        let failed = repositories
            .iter()
            .find(|repository| repository.project_location_id == second_repository_id)
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
                name: "Partial fork".into(),
                description: None,
            }),
        )
        .await
        .expect("retain the same partial location set in a Fork");
        let fork_locations = state.store.workspace_locations(&fork.id).unwrap();
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
}

#[cfg(any())]
mod tests {
    use std::path::{Path, PathBuf};

    use axum::{
        Json,
        body::{Body, to_bytes},
        extract::State,
        http::{Request, StatusCode},
    };
    use tower::ServiceExt;

    use super::{
        ApiJson, AppState, CreateDeliveryPreflight, CreateFork, CreateProject, CreateSession,
        CreateTodo, CreateWorkspace, FinishWorkspace, ParsedGitWorktree, UpdateProject, app,
        command_output, create_delivery_preflight_impl, create_fork, create_project,
        create_project_session, create_session, create_todo, create_workspace, delete_project,
        finish_workspace, finish_workspace_impl, git_head, git_is_ancestor,
        git_worktrees, id_for_operation, normalized_path, parse_git_history, parse_git_worktrees,
        rebase_in_progress, reveal_in_file_manager, slug,
        treefold_developer_instructions, update_project,
    };

    use crate::{
        model::{Directory, Session, Workspace},
        settings::{AgentsSettingsPatch, CodexAgentSettingsPatch, SettingsPatch, SettingsStore},
        store::{Store, now},
        terminal::TerminalManager,
    };

    fn test_settings(home: &Path) -> SettingsStore {
        SettingsStore::open(home).expect("open test settings")
    }

    async fn agent_api_fixture() -> (PathBuf, AppState, Session, Session) {
        let root =
            std::env::temp_dir().join(format!("treefold-agent-api-test-{}", uuid::Uuid::new_v4()));
        let repository = root.join("repository");
        let home = root.join("home");
        std::fs::create_dir_all(&repository).expect("create agent API repository");
        let state = AppState {
            store: Store::open(&home.join("data/treefold.db")).expect("open agent API store"),
            settings: test_settings(&home),
            terminals: TerminalManager::default(),
            runtime: RuntimeHub::default(),
        };
        let (_, Json(project)) = create_project(
            State(state.clone()),
            ApiJson(CreateProject {
                name: Some("Agent API".into()),
                description: None,
                path: repository.to_string_lossy().into_owned(),
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
                name: "Managed work".into(),
                description: None,
                checkout_mode: Some("in_place".into()),
                target_branch: None,
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
            .expect("create first Session");
        state
            .store
            .create_session(&second)
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
        assert_eq!(value["workspace"]["path"], first.cwd);
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
            state.store.todo(todo_id),
            Err(crate::error::AppError::NotFound)
        ));
        drop(state);
        std::fs::remove_dir_all(root).expect("remove agent Todo fixture");
    }

    #[test]
    fn reveal_rejects_a_missing_path() {
        let path =
            std::env::temp_dir().join(format!("treefold-missing-reveal-{}", uuid::Uuid::new_v4()));
        assert!(reveal_in_file_manager(&path.to_string_lossy()).is_err());
    }

    #[tokio::test]
    async fn project_archive_closes_sessions_and_is_required_before_delete() {
        let root = std::env::temp_dir().join(format!(
            "treefold-project-archive-test-{}",
            uuid::Uuid::new_v4()
        ));
        let repository = root.join("repository");
        let home = root.join("home");
        std::fs::create_dir_all(&repository).expect("create Project directory");
        let state = AppState {
            store: Store::open(&home.join("data/treefold.db")).expect("open store"),
            settings: test_settings(&home),
            terminals: TerminalManager::default(),
            runtime: RuntimeHub::default(),
        };
        let (_, Json(project)) = create_project(
            State(state.clone()),
            ApiJson(CreateProject {
                name: Some("Archive lifecycle".into()),
                description: None,
                path: repository.to_string_lossy().into_owned(),
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
                name: Some("Archive shell".into()),
                kind: Some("shell".into()),
                project_directory_id: None,
                initial_prompt: None,
            }),
        )
        .await
        .expect("create Shell Session");
        assert!(state.terminals.is_running(&shell.id).await);

        let mut codex = shell.clone();
        codex.id = uuid::Uuid::new_v4().simple().to_string();
        codex.name = "Archive Codex".into();
        codex.kind = "codex".into();
        codex.codex_session_id = Some("archive-codex-session".into());
        codex.amux_process_name = codex.id.clone();
        codex.status = "exited".into();
        codex.exit_code = Some(0);
        codex.argv.clear();
        state
            .store
            .create_session(&codex)
            .expect("create retained Codex Session");

        let Json(archived) = update_project(
            State(state.clone()),
            axum::extract::Path(project.id.clone()),
            ApiJson(UpdateProject {
                name: None,
                description: None,
                status: Some("archived".into()),
                default_location_id: None,
                default_base_branch: None,
                default_delivery_mode: None,
            }),
        )
        .await
        .expect("archive Project");
        assert_eq!(archived.status, "archived");
        assert!(!state.terminals.is_running(&shell.id).await);
        assert_eq!(
            state
                .store
                .session(&shell.id)
                .expect("read Shell")
                .visibility,
            "visible"
        );
        assert_eq!(
            state.store.session(&shell.id).expect("read Shell").status,
            "stopped"
        );
        assert_eq!(
            state
                .store
                .session(&codex.id)
                .expect("read Codex")
                .visibility,
            "visible"
        );
        assert!(
            update_project(
                State(state.clone()),
                axum::extract::Path(project.id.clone()),
                ApiJson(UpdateProject {
                    name: Some("Archived edit".into()),
                    description: None,
                    status: None,
                    default_location_id: None,
                    default_base_branch: None,
                    default_delivery_mode: None,
                }),
            )
            .await
            .is_err()
        );

        let Json(restored) = update_project(
            State(state.clone()),
            axum::extract::Path(project.id.clone()),
            ApiJson(UpdateProject {
                name: None,
                description: None,
                status: Some("active".into()),
                default_location_id: None,
                default_base_branch: None,
                default_delivery_mode: None,
            }),
        )
        .await
        .expect("restore Project");
        assert_eq!(restored.status, "active");
        assert_eq!(
            state
                .store
                .session(&shell.id)
                .expect("read Shell")
                .visibility,
            "visible"
        );
        assert!(
            delete_project(
                State(state.clone()),
                axum::extract::Path(project.id.clone())
            )
            .await
            .is_err()
        );

        let Json(_) = update_project(
            State(state.clone()),
            axum::extract::Path(project.id.clone()),
            ApiJson(UpdateProject {
                name: None,
                description: None,
                status: Some("archived".into()),
                default_location_id: None,
                default_base_branch: None,
                default_delivery_mode: None,
            }),
        )
        .await
        .expect("archive Project before delete");
        delete_project(State(state.clone()), axum::extract::Path(project.id))
            .await
            .expect("delete archived Project");
        assert!(state.store.projects().expect("list Projects").is_empty());
        drop(state);
        std::fs::remove_dir_all(root).expect("remove archive fixture");
    }

    struct RebaseFixture {
        root: PathBuf,
        repository: PathBuf,
        home: PathBuf,
        state: AppState,
        workspace: Workspace,
        fork: Workspace,
    }

    async fn rebase_fixture(label: &str) -> RebaseFixture {
        let root =
            std::env::temp_dir().join(format!("treefold-rebase-{label}-{}", uuid::Uuid::new_v4()));
        let repository = root.join("repository");
        let home = root.join("home");
        std::fs::create_dir_all(&repository).expect("create rebase repository");
        command_output(Path::new(&repository), "git", &["init", "-b", "main"])
            .expect("initialize rebase repository");
        command_output(
            Path::new(&repository),
            "git",
            &["config", "user.email", "treefold@example.test"],
        )
        .expect("configure rebase email");
        command_output(
            Path::new(&repository),
            "git",
            &["config", "user.name", "Treefold Test"],
        )
        .expect("configure rebase name");
        std::fs::write(repository.join("shared.txt"), "initial\n")
            .expect("write shared fixture file");
        command_output(Path::new(&repository), "git", &["add", "."]).expect("stage rebase fixture");
        command_output(Path::new(&repository), "git", &["commit", "-m", "initial"])
            .expect("commit rebase fixture");

        let state = AppState {
            store: Store::open(&home.join("data/treefold.db")).expect("open rebase store"),
            settings: test_settings(&home),
            terminals: TerminalManager::default(),
            runtime: RuntimeHub::default(),
        };
        let (_, Json(project)) = create_project(
            State(state.clone()),
            ApiJson(CreateProject {
                name: Some(format!("Rebase {label}")),
                description: None,
                path: repository.to_string_lossy().into_owned(),
                directory_description: None,
                directory_worktree_setup_command: None,
            }),
        )
        .await
        .expect("create rebase Project");
        let (_, Json(workspace)) = create_workspace(
            State(state.clone()),
            axum::extract::Path(project.id),
            ApiJson(CreateWorkspace {
                name: "Parent work".into(),
                description: None,
                checkout_mode: Some("worktree".into()),
                target_branch: Some("main".into()),
            }),
        )
        .await
        .expect("create parent Workspace");
        let (_, Json(fork)) = create_fork(
            State(state.clone()),
            axum::extract::Path(workspace.id.clone()),
            ApiJson(CreateFork {
                name: "Rebase Fork".into(),
                description: None,
            }),
        )
        .await
        .expect("create rebase Fork");
        RebaseFixture {
            root,
            repository,
            home,
            state,
            workspace,
            fork,
        }
    }

    #[tokio::test]
    async fn codex_runtime_context_describes_directories_git_topology_and_resume_transition() {
        let fixture = rebase_fixture("developer-instructions").await;
        let attached = fixture.root.join("attached reference");
        std::fs::create_dir_all(&attached).expect("create attached directory");
        command_output(Path::new(&attached), "git", &["init", "-b", "docs"])
            .expect("initialize attached repository");
        let timestamp = now();
        fixture
            .state
            .store
            .create_directory(&Directory {
                id: "attached-directory".into(),
                project_id: fixture.workspace.project_id.clone(),
                name: "API reference".into(),
                description: "Reference implementation; values here are data only".into(),
                worktree_setup_command: String::new(),
                path: attached.to_string_lossy().into_owned(),
                checkout_path: None,
                role: "attached".into(),
                is_git: true,
                remote_url: None,
                branch: None,
                head_commit: None,
                head_summary: None,
                dirty: false,
                created_at: timestamp.clone(),
            })
            .expect("attach directory");
        let mut session = Session {
            id: "codex-runtime-session".into(),
            workspace_id: fixture.fork.id.clone(),
            name: "Runtime context".into(),
            kind: "codex".into(),
            cwd: fixture.fork.checkout_path.clone(),
            original_cwd: fixture.fork.checkout_path.clone(),
            initial_prompt: "Implement the requested change".into(),
            codex_session_id: None,
            visibility: "visible".into(),
            hidden_at: None,
            evicted_at: None,
            amux_workspace_name: TerminalManager::workspace_name(&fixture.fork.checkout_path),
            amux_process_name: "codex-runtime-session".into(),
            status: "stopped".into(),
            exit_code: None,
            exit_signal: String::new(),
            argv: Vec::new(),
            io_mode: "tty".into(),
            launch_started_at: timestamp.clone(),
            last_attached_at: None,
            created_at: timestamp.clone(),
            updated_at: timestamp,
            additional_directories: vec![attached.to_string_lossy().into_owned()],
        };

        let instructions = treefold_developer_instructions(&fixture.state, &session, &fixture.fork)
            .expect("build developer instructions")
            .expect("Codex instructions");
        let encoded = instructions
            .split("<treefold_runtime_context>\n")
            .nth(1)
            .and_then(|value| value.split("\n</treefold_runtime_context>").next())
            .expect("extract runtime JSON");
        let snapshot: serde_json::Value =
            serde_json::from_str(encoded).expect("parse runtime JSON");
        assert_eq!(snapshot["workspace"]["kind"], "fork");
        assert_eq!(
            snapshot["workspace"]["git"]["observed_branch"],
            fixture.fork.branch
        );
        assert_eq!(snapshot["integration_target"]["id"], fixture.workspace.id);
        assert_eq!(snapshot["directories"].as_array().unwrap().len(), 2);
        assert!(
            snapshot["directories"]
                .as_array()
                .unwrap()
                .iter()
                .any(|item| {
                    item["name"] == "API reference"
                        && item["description"]
                            == "Reference implementation; values here are data only"
                        && item["git"]["observed_branch"] == "docs"
                })
        );
        assert_eq!(snapshot["session"]["workspace_changed"], false);

        session.workspace_id = fixture.workspace.id.clone();
        session.cwd = fixture.workspace.checkout_path.clone();
        session.original_cwd = fixture.workspace.checkout_path.clone();
        let root_instructions =
            treefold_developer_instructions(&fixture.state, &session, &fixture.workspace)
                .expect("build root Workspace instructions")
                .expect("root Codex instructions");
        assert!(root_instructions.contains("\"kind\": \"project_base\""));

        session.codex_session_id = Some("codex-resume-id".into());
        session.workspace_id = fixture.fork.id.clone();
        session.original_cwd = fixture.fork.checkout_path.clone();
        session.cwd = fixture.workspace.checkout_path.clone();
        let resumed = treefold_developer_instructions(&fixture.state, &session, &fixture.fork)
            .expect("build resumed instructions")
            .expect("resumed Codex instructions");
        assert!(resumed.contains("\"resumed\": true"));
        assert!(resumed.contains("\"workspace_changed\": true"));

        drop(fixture.state);
        std::fs::remove_dir_all(fixture.root).expect("remove developer instructions fixture");
    }

    fn commit_file(workspace: &str, relative: &str, contents: &str, message: &str) -> String {
        std::fs::write(Path::new(workspace).join(relative), contents).expect("write commit file");
        command_output(Path::new(workspace), "git", &["add", relative]).expect("stage file");
        command_output(Path::new(workspace), "git", &["commit", "-m", message])
            .expect("commit file");
        command_output(Path::new(workspace), "git", &["rev-parse", "HEAD"])
            .expect("read committed head")
    }

    fn recovery_ref_exists(repository: &Path, recovery_ref: &str) -> bool {
        command_output(repository, "git", &["show-ref", "--verify", recovery_ref]).is_ok()
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

    #[tokio::test]
    async fn delivery_preflight_records_delivery_snapshot_and_rejects_stale_git_state() {
        let fixture = rebase_fixture("delivery-preflight").await;
        commit_file(
            &fixture.fork.checkout_path,
            "feature.txt",
            "feature\n",
            "feature commit",
        );
        let preflight = create_delivery_preflight_impl(
            &fixture.state,
            &fixture.fork.id,
            &CreateDeliveryPreflight {
                code_action: "merge".into(),
            },
        )
        .expect("create delivery preflight");
        assert_eq!(preflight.ahead, 1);
        assert_eq!(preflight.commits.len(), 1);
        assert_eq!(
            fixture
                .state
                .store
                .delivery_preflight(&preflight.id)
                .expect("reload persisted preflight"),
            preflight
        );

        commit_file(
            &fixture.workspace.checkout_path,
            "parent-after-preflight.txt",
            "parent moved\n",
            "move target after preflight",
        );
        let stale = finish_workspace_impl(
            &fixture.state,
            &fixture.fork.id,
            &FinishWorkspace {
                code_action: "merge".into(),
                todo_action: "carry".into(),
                keep_session_history: true,
                delete_worktree: true,
                delete_branch: true,
                commit_message: None,
                preflight_id: Some(preflight.id),
            },
            None,
        )
        .await
        .expect_err("stale preflight must not settle");
        assert!(stale.to_string().contains("preflight is stale"));
        assert_eq!(
            fixture
                .state
                .store
                .workspace(&fixture.fork.id)
                .expect("Fork remains active")
                .status,
            "active"
        );

        let root = fixture.root.clone();
        drop(fixture);
        std::fs::remove_dir_all(root).expect("remove delivery preflight fixture");
    }



    #[tokio::test]
    async fn fork_delivery_merges_code_carries_todos_and_cleans_git_resources() {
        let root =
            std::env::temp_dir().join(format!("treefold-fork-flow-test-{}", uuid::Uuid::new_v4()));
        let repository = root.join("repository");
        let home = root.join("home");
        std::fs::create_dir_all(&repository).expect("create repository");
        command_output(Path::new(&repository), "git", &["init", "-b", "main"])
            .expect("initialize repository");
        command_output(
            Path::new(&repository),
            "git",
            &["config", "user.email", "treefold@example.test"],
        )
        .expect("configure email");
        command_output(
            Path::new(&repository),
            "git",
            &["config", "user.name", "Treefold Test"],
        )
        .expect("configure name");
        std::fs::write(repository.join("README.md"), "initial\n").expect("write initial file");
        command_output(Path::new(&repository), "git", &["add", "."]).expect("stage initial");
        command_output(Path::new(&repository), "git", &["commit", "-m", "initial"])
            .expect("commit initial");

        let state = AppState {
            store: Store::open(&home.join("data/treefold.db")).expect("open store"),
            settings: test_settings(&home),
            terminals: TerminalManager::default(),
            runtime: RuntimeHub::default(),
        };
        state
            .settings
            .update(SettingsPatch {
                agents: Some(AgentsSettingsPatch {
                    codex: Some(CodexAgentSettingsPatch {
                        extra_args: Some(vec![
                            "--dangerously-bypass-approvals-and-sandbox".into(),
                            "--search".into(),
                        ]),
                    }),
                }),
                ..SettingsPatch::default()
            })
            .expect("configure TOML-backed settings");
        let setup_log = root.join("worktree-setup.log");
        let setup_command = format!(
            "test -n \"$PWD\" && printf '%s\\n' \"$PWD\" >> '{}'",
            setup_log.to_string_lossy()
        );
        let (_, Json(project)) = create_project(
            State(state.clone()),
            ApiJson(CreateProject {
                name: Some("Test Project".into()),
                description: None,
                path: repository.to_string_lossy().into_owned(),
                directory_description: None,
                directory_worktree_setup_command: Some(setup_command),
            }),
        )
        .await
        .expect("create project");
        let (_, Json(workspace)) = create_workspace(
            State(state.clone()),
            axum::extract::Path(project.id.clone()),
            ApiJson(CreateWorkspace {
                name: "Feature".into(),
                description: None,
                checkout_mode: Some("worktree".into()),
                target_branch: Some("main".into()),
            }),
        )
        .await
        .expect("create workspace");
        assert!(Path::new(&workspace.checkout_path).starts_with(&home));
        let (_, Json(fork)) = create_fork(
            State(state.clone()),
            axum::extract::Path(workspace.id.clone()),
            ApiJson(CreateFork {
                name: "Independent part".into(),
                description: None,
            }),
        )
        .await
        .expect("create fork");
        assert_eq!(fork.kind, "fork");
        assert_eq!(
            fork.parent_workspace_id.as_deref(),
            Some(workspace.id.as_str())
        );
        let setup_paths = std::fs::read_to_string(&setup_log)
            .expect("read Worktree setup command output")
            .lines()
            .map(normalized_path)
            .collect::<Vec<_>>();
        assert_eq!(
            setup_paths,
            [
                normalized_path(&workspace.checkout_path),
                normalized_path(&fork.checkout_path)
            ],
            "Worktree setup command must run in every new managed workspace"
        );
        let directory = state
            .store
            .directory(&project.primary_directory_id)
            .expect("read primary Directory");
        let worktrees_before_failed_setup = git_worktrees(&directory.path)
            .expect("list worktrees before failed setup")
            .len();
        state
            .store
            .update_directory(
                &directory.id,
                &directory.name,
                &directory.description,
                "printf 'setup failed' >&2; exit 23",
                None,
                None,
            )
            .expect("configure failing Worktree setup command");
        let setup_error = create_workspace(
            State(state.clone()),
            axum::extract::Path(project.id.clone()),
            ApiJson(CreateWorkspace {
                name: "Failed setup".into(),
                description: None,
                checkout_mode: Some("worktree".into()),
                target_branch: Some("main".into()),
            }),
        )
        .await
        .expect_err("failed Worktree setup must reject creation");
        assert!(setup_error.to_string().contains("setup failed"));
        assert_eq!(
            git_worktrees(&directory.path)
                .expect("list worktrees after failed setup")
                .len(),
            worktrees_before_failed_setup,
            "failed Worktree setup must clean its worktree registration"
        );
        assert!(
            create_fork(
                State(state.clone()),
                axum::extract::Path(fork.id.clone()),
                ApiJson(CreateFork {
                    name: "Nested".into(),
                    description: None,
                }),
            )
            .await
            .is_err()
        );

        let (_, Json(fork_shell)) = create_session(
            State(state.clone()),
            axum::extract::Path(fork.id.clone()),
            ApiJson(CreateSession {
                name: Some("Fork shell".into()),
                kind: Some("shell".into()),
                project_directory_id: None,
                initial_prompt: None,
            }),
        )
        .await
        .expect("create Shell Session in Fork");
        assert_eq!(fork_shell.workspace_id, fork.id);
        assert_eq!(fork_shell.cwd, fork.checkout_path);
        assert!(state.terminals.is_running(&fork_shell.id).await);

        let _ = create_todo(
            State(state.clone()),
            axum::extract::Path(fork.id.clone()),
            ApiJson(CreateTodo {
                title: "Carry me".into(),
                description: None,
                session_id: None,
            }),
        )
        .await
        .expect("create Todo");
        let timestamp = now();
        let session = Session {
            id: uuid::Uuid::new_v4().simple().to_string(),
            workspace_id: fork.id.clone(),
            name: "Archived Codex".into(),
            kind: "codex".into(),
            cwd: fork.checkout_path.clone(),
            original_cwd: fork.checkout_path.clone(),
            initial_prompt: "Continue the independent part".into(),
            codex_session_id: Some("codex-session-for-resume".into()),
            visibility: "visible".into(),
            hidden_at: None,
            evicted_at: None,
            amux_workspace_name: TerminalManager::workspace_name(&fork.checkout_path),
            amux_process_name: "archived-codex".into(),
            status: "exited".into(),
            exit_code: Some(0),
            exit_signal: String::new(),
            argv: vec!["codex".into()],
            io_mode: "tty".into(),
            launch_started_at: timestamp.clone(),
            last_attached_at: None,
            created_at: timestamp.clone(),
            updated_at: timestamp,
            additional_directories: Vec::new(),
        };
        state
            .store
            .create_session(&session)
            .expect("create resumable session history");
        std::fs::write(
            Path::new(&fork.checkout_path).join("fork.txt"),
            "fork work\n",
        )
        .expect("write fork change");

        let fork_preflight = create_delivery_preflight_impl(
            &state,
            &fork.id,
            &CreateDeliveryPreflight {
                code_action: "merge".into(),
            },
        )
        .expect("preflight Fork delivery");
        assert!(fork_preflight.source_dirty);
        assert!(
            fork_preflight
                .changed_files
                .iter()
                .any(|file| file == "fork.txt")
        );
        let delivery = FinishWorkspace {
            code_action: "merge".into(),
            todo_action: "carry".into(),
            keep_session_history: true,
            delete_worktree: true,
            delete_branch: true,
            commit_message: Some("complete fork".into()),
            preflight_id: Some(fork_preflight.id),
        };
        let interrupted =
            finish_workspace_impl(&state, &fork.id, &delivery, Some("code_integrated"))
                .await
                .expect_err("inject failure after merge");
        assert!(
            interrupted
                .to_string()
                .contains("injected delivery failure after code_integrated")
        );
        let interrupted_operation = state
            .store
            .delivery_operation(&fork.id)
            .expect("load interrupted delivery")
            .expect("persist interrupted delivery");
        assert_eq!(interrupted_operation.phase, "code_integrated");
        assert!(!interrupted_operation.before_head.is_empty());
        assert!(!interrupted_operation.source_head.is_empty());
        assert_eq!(
            interrupted_operation.target_head,
            interrupted_operation
                .integrated_commit
                .clone()
                .expect("record integrated commit")
        );
        assert!(
            interrupted_operation
                .error
                .contains("injected delivery failure")
        );
        let reopened_store =
            Store::open(&home.join("data/treefold.db")).expect("reopen persistent store");
        assert_eq!(
            reopened_store
                .delivery_operation(&fork.id)
                .expect("reload interrupted delivery")
                .expect("delivery survives store reopen")
                .phase,
            "code_integrated"
        );
        drop(reopened_store);
        assert_eq!(
            state.store.workspace(&fork.id).expect("active Fork").status,
            "active"
        );
        assert!(Path::new(&fork.checkout_path).exists());
        assert!(
            command_output(Path::new(&repository), "git", &["branch", "--list"])
                .expect("list branches after interruption")
                .contains(&fork.branch)
        );
        assert!(
            Path::new(&workspace.checkout_path)
                .join("fork.txt")
                .exists()
        );
        assert_eq!(
            state
                .store
                .todos(&workspace.id)
                .expect("parent Todos before retry")
                .len(),
            0
        );
        assert_eq!(
            state
                .store
                .session(&session.id)
                .expect("unsettled Session")
                .status,
            "exited"
        );
        let target_head_after_interruption = command_output(
            Path::new(&workspace.checkout_path),
            "git",
            &["rev-parse", "HEAD"],
        )
        .expect("parent head after interruption");
        let parent_commit_count_after_interruption = command_output(
            Path::new(&workspace.checkout_path),
            "git",
            &["rev-list", "--count", "HEAD"],
        )
        .expect("parent commit count after interruption");

        let Json(settled) = finish_workspace(
            State(state.clone()),
            axum::extract::Path(fork.id.clone()),
            ApiJson(delivery.clone()),
        )
        .await
        .expect("resume interrupted Fork delivery");
        assert_eq!(settled.status, "archived");
        assert_eq!(settled.delivery_status, "merged");
        assert_eq!(
            command_output(
                Path::new(&workspace.checkout_path),
                "git",
                &["rev-parse", "HEAD"]
            )
            .expect("parent head after retry"),
            target_head_after_interruption
        );
        assert_eq!(
            command_output(
                Path::new(&workspace.checkout_path),
                "git",
                &["rev-list", "--count", "HEAD"]
            )
            .expect("parent commit count after retry"),
            parent_commit_count_after_interruption
        );
        assert!(!Path::new(&fork.checkout_path).exists());
        assert!(
            Path::new(&workspace.checkout_path)
                .join("fork.txt")
                .exists()
        );
        assert_eq!(
            state
                .store
                .todos(&workspace.id)
                .expect("parent Todos")
                .len(),
            1
        );
        assert_eq!(
            state
                .store
                .todos(&fork.id)
                .expect("archived Fork Todos")
                .len(),
            1
        );
        let archived_session = state.store.session(&session.id).expect("session history");
        assert_eq!(archived_session.status, "stopped");
        assert_eq!(archived_session.visibility, "hidden");
        assert_eq!(archived_session.cwd, workspace.checkout_path);
        assert_eq!(archived_session.original_cwd, fork.checkout_path);
        assert_eq!(
            archived_session.codex_session_id.as_deref(),
            Some("codex-session-for-resume")
        );
        let archived_shell = state.store.session(&fork_shell.id).expect("Shell history");
        assert_eq!(archived_shell.status, "stopped");
        assert_eq!(archived_shell.cwd, workspace.checkout_path);
        let branches = command_output(Path::new(&repository), "git", &["branch", "--list"])
            .expect("list branches");
        assert!(!branches.contains(&fork.branch));
        let completed_operation = state
            .store
            .delivery_operation(&fork.id)
            .expect("load completed delivery")
            .expect("persist completed delivery");
        assert_eq!(completed_operation.phase, "archived");
        assert!(completed_operation.error.is_empty());

        let Json(settled_again) = finish_workspace(
            State(state.clone()),
            axum::extract::Path(fork.id.clone()),
            ApiJson(delivery),
        )
        .await
        .expect("repeat completed Fork delivery");
        assert_eq!(settled_again.status, "archived");
        assert_eq!(
            command_output(
                Path::new(&workspace.checkout_path),
                "git",
                &["rev-parse", "HEAD"]
            )
            .expect("parent head after repeated request"),
            target_head_after_interruption
        );
        assert_eq!(
            state
                .store
                .todos(&workspace.id)
                .expect("parent Todos after repeated request")
                .len(),
            1
        );

        let root_preflight = create_delivery_preflight_impl(
            &state,
            &workspace.id,
            &CreateDeliveryPreflight {
                code_action: "merge".into(),
            },
        )
        .expect("preflight root Workspace delivery");
        let Json(settled_root) = finish_workspace(
            State(state.clone()),
            axum::extract::Path(workspace.id.clone()),
            ApiJson(FinishWorkspace {
                code_action: "merge".into(),
                todo_action: "carry".into(),
                keep_session_history: true,
                delete_worktree: true,
                delete_branch: true,
                commit_message: None,
                preflight_id: Some(root_preflight.id),
            }),
        )
        .await
        .expect("settle root Workspace into Project");
        assert_eq!(settled_root.status, "archived");
        assert_eq!(settled_root.delivery_status, "merged");
        assert!(!Path::new(&workspace.checkout_path).exists());
        assert!(repository.join("fork.txt").exists());
        assert_eq!(
            state
                .store
                .project_todos(&project.id)
                .expect("Project Todos")
                .len(),
            1
        );
        let branches = command_output(Path::new(&repository), "git", &["branch", "--list"])
            .expect("list branches after root delivery");
        assert!(!branches.contains(&workspace.branch));

        drop(state);
        std::fs::remove_dir_all(root).expect("remove test root");
    }
}
