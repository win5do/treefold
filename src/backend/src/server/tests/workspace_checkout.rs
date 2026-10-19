use std::path::Path;

use axum::{Json, extract::State};
use serde_json::{Value, json};

use super::{
    current_workspace_tests::{initialize_repository, test_state},
    *,
};

async fn fixture() -> (
    tempfile::TempDir,
    AppState,
    Project,
    Vec<crate::model::ProjectRepository>,
) {
    let root = tempfile::tempdir().unwrap();
    let first = root.path().join("first");
    let second = root.path().join("second");
    initialize_repository(&first);
    initialize_repository(&second);
    let state = test_state(root.path()).await;
    let (_, Json(project)) = create_project(
        State(state.clone()),
        ApiJson(
            serde_json::from_value(json!({
                "name": "Checkout choices", "locations": [first, second]
            }))
            .unwrap(),
        ),
    )
    .await
    .unwrap();
    let mut repositories = state.store.repositories(&project.id).await.unwrap();
    repositories.sort_by(|a, b| a.name.cmp(&b.name));
    (root, state, project, repositories)
}

fn git(repository: &crate::model::ProjectRepository, args: &[&str]) -> String {
    command_output(Path::new(&repository.source_root), "git", args).unwrap()
}

fn new_choice(id: &str, name: &str) -> Value {
    json!({ "repository_id": id, "checkout": { "mode": "new", "branch": name, "base": { "kind": "local", "branch": "main" } }, "upstream": null })
}

async fn prepare(
    state: &AppState,
    project: &Project,
    repositories: Vec<Value>,
) -> Result<super::super::workspace_creation::PreparedWorkspace> {
    prepare_workspace(
        state.clone(),
        project.id.clone(),
        serde_json::from_value(json!({ "repositories": repositories })).unwrap(),
        vec![],
    )
    .await
}

#[tokio::test]
async fn workspace_checkout_mixes_new_base_and_existing_local_and_forks_each_head() {
    let (_root, state, project, repositories) = fixture().await;
    let first = &repositories[0];
    let second = &repositories[1];
    git(
        first,
        &["remote", "add", "origin", "https://example.test/repo.git"],
    );
    let start = git(first, &["rev-parse", "HEAD"]);
    git(
        first,
        &["update-ref", "refs/remotes/origin/release", &start],
    );
    std::fs::write(Path::new(&first.source_root).join("later"), "later").unwrap();
    git(first, &["add", "."]);
    git(first, &["commit", "-m", "later on Project"]);
    git(second, &["branch", "existing-feature"]);
    let prepared = prepare(&state, &project, vec![
        json!({ "repository_id": first.id, "checkout": { "mode": "new", "branch": "feature/first", "base": { "kind": "remote", "remote": "origin", "branch": "release" } }, "upstream": { "remote": "origin", "branch": "publish-first" } }),
        json!({ "repository_id": second.id, "checkout": { "mode": "existing", "source": { "kind": "local", "branch": "existing-feature" } }, "upstream": null }),
    ]).await.unwrap();
    // New branches freeze the chosen base; reused branches check out their live tip.
    git(
        first,
        &["update-ref", "refs/remotes/origin/release", "HEAD"],
    );
    git(
        second,
        &["commit", "--allow-empty", "-m", "advance existing branch"],
    );
    git(second, &["branch", "-f", "existing-feature", "HEAD"]);
    let existing_tip = git(second, &["rev-parse", "existing-feature"]);
    let created = super::super::workspace_creation::complete(&state, prepared)
        .await
        .unwrap()
        .workspace;
    assert_eq!(created.default_delivery, "local_merge");
    assert_eq!(
        state
            .store
            .workspace(&created.id)
            .await
            .unwrap()
            .default_delivery,
        "local_merge"
    );
    let snapshots = state
        .store
        .workspace_repositories(&created.id)
        .await
        .unwrap();
    let one = snapshots
        .iter()
        .find(|item| item.project_repository_id == first.id)
        .unwrap();
    let two = snapshots
        .iter()
        .find(|item| item.project_repository_id == second.id)
        .unwrap();
    assert_eq!(one.git_status, "ready");
    assert_eq!(one.branch.as_deref(), Some("feature/first"));
    assert_eq!(one.base_branch.as_deref(), Some("origin/release"));
    assert_eq!(one.start_commit.as_deref(), Some(start.as_str()));
    assert_eq!(one.remote_branch.as_deref(), Some("publish-first"));
    assert_eq!(one.branch_ownership, "managed");
    assert_eq!(two.branch.as_deref(), Some("existing-feature"));
    assert_eq!(two.branch_ownership, "user");
    assert_eq!(two.start_commit.as_deref(), Some(existing_tip.as_str()));
    assert!(two.remote_name.is_none());
    assert_eq!(git(first, &["branch", "--show-current"]), "main");
    assert_eq!(git(second, &["branch", "--show-current"]), "main");

    let prepared = super::super::fork::prepare_fork(
        state.clone(),
        created.id.clone(),
        serde_json::from_value(json!({ "branch": "fork/child" })).unwrap(),
    )
    .await
    .unwrap();
    let fork = super::super::workspace_creation::complete(&state, prepared)
        .await
        .unwrap()
        .workspace;
    assert_eq!(fork.default_delivery, "local_merge");
    for child in state.store.workspace_repositories(&fork.id).await.unwrap() {
        let parent = snapshots
            .iter()
            .find(|parent| parent.project_repository_id == child.project_repository_id)
            .unwrap();
        assert_eq!(child.git_status, "ready");
        assert_eq!(child.base_branch, parent.branch);
        assert_eq!(child.forked_from_commit, parent.start_commit);
    }
}

#[tokio::test]
async fn workspace_checkout_rejects_occupied_and_invalid_choices_before_creation() {
    let (root, state, project, repositories) = fixture().await;
    let first = &repositories[0];
    let second = &repositories[1];
    let occupied = root.path().join("external");
    git(
        second,
        &[
            "worktree",
            "add",
            "-b",
            "occupied",
            occupied.to_str().unwrap(),
        ],
    );
    let choices = vec![
        new_choice(&first.id, "would-create"),
        json!({ "repository_id": second.id, "checkout": { "mode": "existing", "source": { "kind": "local", "branch": "occupied" } } }),
    ];
    let error = prepare(&state, &project, choices)
        .await
        .err()
        .unwrap()
        .to_string();
    assert!(error.contains("already checked out"), "{error}");
    assert!(error.contains(occupied.to_str().unwrap()));
    assert!(
        git_ref_names(&first.source_root, "refs/heads")
            .unwrap()
            .iter()
            .all(|branch| branch != "would-create")
    );
    assert!(
        state
            .store
            .workspaces(&project.id)
            .await
            .unwrap()
            .is_empty()
    );
    let options = directory_branches(&second.source_root).unwrap();
    assert_eq!(
        normalized_path(&options.occupied["occupied"]),
        normalized_path(occupied.to_str().unwrap())
    );
    assert!(options.occupied.contains_key("main"));

    for choices in [
        vec![
            new_choice(&first.id, "same"),
            new_choice(&first.id, "other"),
        ],
        vec![new_choice(&first.id, "same")],
        vec![
            new_choice(&first.id, "same"),
            new_choice("foreign", "other"),
        ],
        vec![
            new_choice(&first.id, "main"),
            new_choice(&second.id, "other"),
        ],
        vec![
            new_choice(&first.id, "../invalid"),
            new_choice(&second.id, "other"),
        ],
        vec![
            new_choice(&first.id, "same"),
            json!({ "repository_id": second.id, "checkout": { "mode": "new", "branch": "other", "base": { "kind": "local", "branch": "missing" } } }),
        ],
    ] {
        assert!(prepare(&state, &project, choices).await.is_err());
    }
    assert!(
        state
            .store
            .workspaces(&project.id)
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn workspace_checkout_generated_defaults_share_root_and_retry_without_touching_explicit_names()
 {
    let (_root, state, project, repositories) = fixture().await;
    let preview = "treefold/261019-1234-abcd";
    git(&repositories[0], &["branch", preview]);
    let old_tip = git(&repositories[0], &["rev-parse", preview]);
    let prepared = prepare_workspace(state.clone(), project.id.clone(), serde_json::from_value(json!({
        "generated_branch": preview,
        "repositories": [new_choice(&repositories[0].id, preview), new_choice(&repositories[1].id, "explicit-name")]
    })).unwrap(), vec![]).await.unwrap();
    let first_plan = prepared
        .plans
        .iter()
        .find(|plan| plan.location.id == repositories[0].id)
        .unwrap();
    assert_ne!(first_plan.branch, preview);
    assert_eq!(
        prepared.root.path().file_name().unwrap().to_str().unwrap(),
        first_plan.branch.strip_prefix("treefold/").unwrap()
    );
    let second_plan = prepared
        .plans
        .iter()
        .find(|plan| plan.location.id == repositories[1].id)
        .unwrap();
    assert_eq!(second_plan.branch, "explicit-name");
    let created = super::super::workspace_creation::complete(&state, prepared)
        .await
        .unwrap()
        .workspace;
    assert_eq!(created.default_delivery, "local_merge");
    assert_eq!(git(&repositories[0], &["rev-parse", preview]), old_tip);
}

#[tokio::test]
async fn workspace_checkout_remote_creates_local_without_replacing_existing_branch() {
    let (_root, state, project, repositories) = fixture().await;
    let first = &repositories[0];
    let second = &repositories[1];
    git(
        first,
        &["remote", "add", "origin", "https://example.test/repo.git"],
    );
    git(first, &["update-ref", "refs/remotes/origin/topic", "HEAD"]);
    git(first, &["branch", "topic"]);
    git(first, &["config", "branch.topic.remote", "origin"]);
    git(
        first,
        &[
            "config",
            "branch.topic.merge",
            "refs/heads/not-published-yet",
        ],
    );
    let branches = directory_branches(&first.source_root).unwrap();
    assert_eq!(branches.upstreams["topic"].branch, "not-published-yet");
    let choice = |local: &str| json!({ "repository_id": first.id, "checkout": { "mode": "existing", "source": { "kind": "remote", "remote": "origin", "branch": "topic" }, "local_branch": local }, "upstream": { "remote": "origin", "branch": "topic" } });
    assert!(
        prepare(
            &state,
            &project,
            vec![choice("topic"), new_choice(&second.id, "second")]
        )
        .await
        .err()
        .unwrap()
        .to_string()
        .contains("already exists")
    );
    let prepared = prepare(
        &state,
        &project,
        vec![choice("topic-copy"), new_choice(&second.id, "second")],
    )
    .await
    .unwrap();
    let created = super::super::workspace_creation::complete(&state, prepared)
        .await
        .unwrap()
        .workspace;
    let snapshots = state
        .store
        .workspace_repositories(&created.id)
        .await
        .unwrap();
    let one = snapshots
        .iter()
        .find(|item| item.project_repository_id == first.id)
        .unwrap();
    assert_eq!(one.git_status, "ready");
    assert_eq!(one.branch.as_deref(), Some("topic-copy"));
    assert_eq!(one.branch_ownership, "managed");
    assert_eq!(one.remote_name.as_deref(), Some("origin"));
    assert_eq!(one.remote_branch.as_deref(), Some("topic"));
    assert_eq!(
        git(first, &["rev-parse", "topic"]),
        git(first, &["rev-parse", "topic-copy"])
    );
}
