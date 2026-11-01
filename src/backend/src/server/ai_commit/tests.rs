use super::*;
use crate::{
    server::{create_project, test_support},
    terminal::TerminalManager,
};
use std::path::Path;
fn git(path: &Path, args: &[&str]) -> String {
    crate::git::output(path, args).unwrap()
}

#[tokio::test]
async fn staged_and_history_contexts_describe_only_selected_changes_and_detect_index_edits() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("repo");
    std::fs::create_dir(&path).unwrap();
    git(&path, &["init", "-b", "main"]);
    git(&path, &["config", "user.name", "Test"]);
    git(&path, &["config", "user.email", "test@example.test"]);
    git(&path, &["config", "commit.gpgsign", "false"]);
    let mut commits = vec![];
    for text in ["base", "first-feature", "second-feature", "later-feature"] {
        std::fs::write(path.join("file"), format!("{text}\n")).unwrap();
        git(&path, &["add", "file"]);
        git(&path, &["commit", "-m", text]);
        commits.push(git(&path, &["rev-parse", "HEAD"]));
    }
    let state =
        test_support::app_state(&root.path().join("home"), TerminalManager::default()).await;
    let (_, Json(project)) = create_project(
        State(state.clone()),
        ApiJson(
            serde_json::from_value(
                serde_json::json!({ "name": "AI Commit test", "locations": [path] }),
            )
            .unwrap(),
        ),
    )
    .await
    .unwrap();
    let repositories = state.store.repositories(&project.id).await.unwrap();
    let id = repositories[0].id.clone();
    let history = context::prepare(
        &state,
        &Request {
            repository_kind: "project".into(),
            repository_id: id.clone(),
            source: Source::History {
                commits: commits[1..3].to_vec(),
                expected_head: commits[3].clone(),
            },
        },
    )
    .await
    .unwrap();
    let diff = history.prompt.split("Diff:\n").last().unwrap();
    assert!(diff.contains("+second-feature"));
    assert!(!diff.contains("later-feature"));
    std::fs::write(path.join("file"), "staged-content\n").unwrap();
    git(&path, &["add", "file"]);
    std::fs::write(path.join("file"), "unstaged-secret\n").unwrap();
    let snapshot = crate::server::git_routes::git_status(path.to_str().unwrap())
        .unwrap()
        .snapshot;
    let staged = context::prepare(
        &state,
        &Request {
            repository_kind: "project".into(),
            repository_id: id,
            source: Source::Staged {
                expected_snapshot: snapshot,
            },
        },
    )
    .await
    .unwrap();
    assert!(staged.prompt.contains("+staged-content"));
    assert!(!staged.prompt.contains("unstaged-secret"));
    let statistics = staged
        .prompt
        .split("File statistics:\n")
        .nth(1)
        .unwrap()
        .split("Diff:\n")
        .next()
        .unwrap();
    assert!(!statistics.contains("diff --git"));
    git(&path, &["add", "file"]);
    assert!(staged.verify().await.is_err());
    assert_eq!(git(&path, &["rev-parse", "HEAD"]), commits[3]);
}

#[test]
fn large_diffs_keep_other_files_and_bound_prompt() {
    let patch = format!(
        "diff --git a/package-lock.json b/package-lock.json\n{}\ndiff --git a/main.rs b/main.rs\n+important fix",
        "lock data\n".repeat(30000)
    );
    let prompt = context::prompt("main", "", "", "2 files", &patch);
    assert!(prompt.contains("important fix"));
    assert!(prompt.contains("truncated"));
    assert!(prompt.len() < 64 * 1024);
}

#[tokio::test]
async fn delivery_uses_committed_branch_changes_and_checks_target_movement() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("repo");
    std::fs::create_dir(&path).unwrap();
    git(&path, &["init", "-b", "main"]);
    git(&path, &["config", "user.name", "Test"]);
    git(&path, &["config", "user.email", "test@example.test"]);
    git(&path, &["config", "commit.gpgsign", "false"]);
    std::fs::write(path.join("file"), "base\n").unwrap();
    git(&path, &["add", "file"]);
    git(&path, &["commit", "-m", "base"]);
    let state =
        test_support::app_state(&root.path().join("home"), TerminalManager::default()).await;
    let (_, Json(project)) = create_project(
        State(state.clone()),
        ApiJson(
            serde_json::from_value(serde_json::json!({ "name": "Delivery", "locations": [path] }))
                .unwrap(),
        ),
    )
    .await
    .unwrap();
    let (_, Json(workspace)) = crate::server::create_workspace(
        State(state.clone()),
        axum::extract::Path(project.id),
        ApiJson(
            serde_json::from_value(
                serde_json::json!({ "branch": "feature/commit", "description": "Commit fixture" }),
            )
            .unwrap(),
        ),
    )
    .await
    .unwrap();
    let repo = tokio::time::timeout(std::time::Duration::from_secs(20), async {
        loop {
            let repo = state
                .store
                .workspace_repositories(&workspace.id)
                .await
                .unwrap()
                .remove(0);
            if repo.git_status != "creating" {
                break repo;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    let checkout =
        std::path::PathBuf::from(crate::server::workspace_repository_git_path(&repo).unwrap());
    std::fs::write(checkout.join("file"), "delivered-feature\n").unwrap();
    git(&checkout, &["commit", "-am", "Add feature"]);
    std::fs::write(checkout.join("file"), "unfinished-local-change\n").unwrap();
    let input = Request {
        repository_kind: "workspace".into(),
        repository_id: repo.id,
        source: Source::Delivery {
            expected_head: git(&checkout, &["rev-parse", "HEAD"]),
            expected_target_head: git(&path, &["rev-parse", "HEAD"]),
        },
    };
    let context = context::prepare(&state, &input).await.unwrap();
    assert!(context.prompt.contains("+delivered-feature"));
    assert!(!context.prompt.contains("unfinished-local-change"));
    context.verify().await.unwrap();
    git(&path, &["commit", "--allow-empty", "-m", "Target moved"]);
    assert!(context.verify().await.is_err());
    assert!(context::prepare(&state, &input).await.is_err());
}

#[tokio::test]
async fn testing_uses_the_unsaved_command_and_presets_do_not_pin_models() {
    let root = tempfile::tempdir().unwrap();
    let state = test_support::app_state(root.path(), TerminalManager::default()).await;
    let Json(job) = test(
        State(state.clone()),
        ApiJson(TestGenerationRequest {
            command: "cat >/dev/null; printf 'Fix guest greeting'".into(),
        }),
    )
    .await
    .unwrap();
    let result = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let job = state.ai_commit.get(&job.id).unwrap();
            if !matches!(job.status.as_str(), "queued" | "running") {
                break job;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(result.status, "succeeded");
    assert_eq!(result.message.as_deref(), Some("Fix guest greeting"));
    assert!(state.settings.load().unwrap().ai_commit.command.is_empty());
    let Json(presets) = presets(State(state)).await.unwrap();
    assert_eq!(presets.len(), 4);
    for preset in presets {
        assert!(!preset.command.contains("--model"));
        assert!(!preset.command.contains("luna"));
    }
}
