use super::*;
use crate::terminal::TerminalManager;

fn git(path: &Path, args: &[&str]) -> String {
    command_output(path, "git", args).unwrap()
}

async fn fixture() -> (
    tempfile::TempDir,
    AppState,
    Workspace,
    Vec<std::path::PathBuf>,
) {
    let root = tempfile::tempdir().unwrap();
    let home = root.path().join("home");
    let state = crate::server::test_support::app_state(&home, TerminalManager::default()).await;
    let paths: Vec<_> = ["backend", "frontend"]
        .iter()
        .map(|name| root.path().join(name))
        .collect();
    for path in &paths {
        std::fs::create_dir_all(path).unwrap();
        git(path, &["init", "-b", "main"]);
        git(path, &["config", "user.email", "test@example.test"]);
        git(path, &["config", "user.name", "Test"]);
        std::fs::write(path.join("code.txt"), "base").unwrap();
        git(path, &["add", "."]);
        git(path, &["commit", "-m", "base"]);
    }
    let (_, Json(project)) = crate::server::create_project(
        State(state.clone()),
        ApiJson(
            serde_json::from_value(serde_json::json!({
                "name": "Review fixture", "locations": paths,
            }))
            .unwrap(),
        ),
    )
    .await
    .unwrap();
    let (_, Json(workspace)) = crate::server::create_workspace(
        State(state.clone()),
        AxumPath(project.id),
        ApiJson(
            serde_json::from_value(serde_json::json!({
                "branch": "feature/review", "description": "Review fixture",
            }))
            .unwrap(),
        ),
    )
    .await
    .unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(20), async {
        loop {
            if state
                .store
                .workspace_repositories(&workspace.id)
                .await
                .unwrap()
                .iter()
                .all(|item| item.git_status != "creating")
            {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    (root, state, workspace, paths)
}

#[tokio::test]
async fn review_resolves_workspace_and_fork_targets_and_preserves_first_user_message() {
    let (_root, state, workspace, paths) = fixture().await;
    // The Project's current branch, rather than the original creation branch,
    // is the Workspace's parent review target.
    git(&paths[0], &["switch", "-c", "release"]);
    let context = review_context(&state, &workspace).await.unwrap();
    assert_eq!(context.repositories.len(), 2);
    let repository = context
        .repositories
        .iter()
        .find(|item| item.name == "backend")
        .unwrap();
    assert_eq!(repository.target_branch, "release");
    assert_eq!(repository.current_branch, "feature/review");
    let checkout = Path::new(&repository.current_path);
    std::fs::write(checkout.join("code.txt"), "child").unwrap();
    git(checkout, &["commit", "-am", "child"]);
    std::fs::write(checkout.join("untracked.txt"), "review this too").unwrap();
    let directory = state
        .store
        .workspace_directories(&workspace.id)
        .await
        .unwrap()
        .remove(0);
    let input = session_input(
        &state,
        &workspace,
        StartReview {
            kind: "pi".into(),
            prompt: "Review then fix the confirmed bugs.\nKeep the public API.".into(),
            project_directory_id: directory.project_directory_id.clone(),
        },
    )
    .await
    .unwrap();
    assert_eq!(input.kind.as_deref(), Some("pi"));
    assert_eq!(
        input.project_directory_id.as_deref(),
        Some(directory.project_directory_id.as_str())
    );
    let prompt = input.initial_prompt.as_ref().unwrap();
    assert!(prompt.starts_with("Review then fix the confirmed bugs.\nKeep the public API.\n"));
    assert!(prompt.contains(&git_head(&repository.current_path).unwrap()));
    assert!(prompt.contains("git ls-files --others --exclude-standard"));
    assert!(prompt.contains(&format!(
        "git diff {}...{} --",
        repository.target_head,
        git_head(&repository.current_path).unwrap()
    )));
    assert!(prompt.contains("frontend") && prompt.contains("backend"));

    // Prepare only, without spawning a CLI: Review uses the same context builder
    // and additional directory handling as an ordinary Agent Session.
    state
        .settings
        .update(
            serde_json::from_value(serde_json::json!({
                "agents": { "pi": { "command": "/usr/bin/true" } }
            }))
            .unwrap(),
        )
        .unwrap();
    let session = crate::server::session::prepare_session(&state, &workspace, input)
        .await
        .unwrap();
    assert_eq!(session.cwd, directory.path);
    assert!(!session.additional_directories.is_empty());
    let instructions =
        crate::server::hosting::treefold_developer_instructions(&state, &session, &workspace)
            .await
            .unwrap()
            .unwrap();
    assert!(instructions.contains(&workspace.id));
    assert!(instructions.contains(&workspace.project_id));
    assert!(instructions.contains(&session.cwd));
    for path in &session.additional_directories {
        assert!(instructions.contains(path));
    }
    assert!(!instructions.contains("Review then fix the confirmed bugs."));
    std::fs::remove_file(checkout.join("untracked.txt")).unwrap();

    // A Fork compares to the parent Workspace, even when the Project has moved.
    let fork = crate::server::fork::create_fork_impl(
        state.clone(),
        workspace.id.clone(),
        serde_json::from_value(serde_json::json!({
            "branch": "task/review", "description": "Review child",
        }))
        .unwrap(),
    )
    .await
    .unwrap()
    .workspace;
    let context = review_context(&state, &fork).await.unwrap();
    for repository in context.repositories {
        assert_eq!(repository.current_branch, "task/review");
        assert_eq!(repository.target_branch, "feature/review");
        assert_eq!(
            repository.target_head,
            git_head(&repository.target_path).unwrap()
        );
        assert_eq!(repository.merge_base, repository.target_head);
    }
    state
        .store
        .update_project_status(&workspace.project_id, "archived")
        .await
        .unwrap();
    assert!(review_workspace(&state, &fork.id).await.is_err());
}

#[tokio::test]
async fn review_rejects_pending_delivery_and_non_agent_requests_without_creating_sessions() {
    let (_root, state, workspace, _paths) = fixture().await;
    let input = StartReview {
        kind: "shell".into(),
        prompt: "Review".into(),
        project_directory_id: "unused".into(),
    };
    assert!(session_input(&state, &workspace, input).await.is_err());
    state
        .store
        .save_finish_batch(&crate::model::FinishBatch {
            workspace_id: workspace.id.clone(),
            continue_work: false,
            status: "paused".into(),
            items: vec![],
            error: None,
        })
        .await
        .unwrap();
    assert!(review_workspace(&state, &workspace.id).await.is_err());
    assert!(
        state
            .store
            .sessions(&workspace.id)
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn project_review_prompt_is_updated_with_project_and_inherited_by_review() {
    let (_root, state, workspace, _paths) = fixture().await;
    let project_id = &workspace.project_id;
    let before = state.store.project(project_id).await.unwrap();
    assert!(
        review_context(&state, &workspace)
            .await
            .unwrap()
            .review_prompt
            .is_empty()
    );
    let prompt = "  Review API compatibility.\n保留原文。  ";
    let update =
        |value: &str| serde_json::from_value(serde_json::json!({"review_prompt": value})).unwrap();
    let Json(saved) = crate::server::workspace::update_project(
        State(state.clone()),
        AxumPath(project_id.clone()),
        ApiJson(update(prompt)),
    )
    .await
    .unwrap();
    assert_eq!(saved.review_prompt, prompt);
    assert_eq!(saved.name, before.name);
    assert_eq!(saved.default_location_id, before.default_location_id);
    assert_eq!(
        review_context(&state, &workspace)
            .await
            .unwrap()
            .review_prompt,
        prompt
    );
    state
        .store
        .update_project_status(project_id, "archived")
        .await
        .unwrap();
    assert!(
        crate::server::workspace::update_project(
            State(state.clone()),
            AxumPath(project_id.clone()),
            ApiJson(update("overwrite")),
        )
        .await
        .is_err()
    );
    assert_eq!(
        state.store.project(project_id).await.unwrap().review_prompt,
        prompt
    );
    state
        .store
        .update_project_status(project_id, "active")
        .await
        .unwrap();
    let _ = crate::server::workspace::update_project(
        State(state.clone()),
        AxumPath(project_id.clone()),
        ApiJson(update(" \n\t")),
    )
    .await
    .unwrap();
    assert!(
        review_context(&state, &workspace)
            .await
            .unwrap()
            .review_prompt
            .is_empty()
    );
}
