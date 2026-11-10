use super::*;
use crate::server::branch_checkout::{CheckoutBranch, workspace_checkout};
use axum::extract::Query;

async fn switch(f: &Fixture, id: &str, input: serde_json::Value) -> Result<WorkspaceRepository> {
    workspace_checkout(
        State(f.state.clone()),
        AxumPath(id.into()),
        ApiJson(serde_json::from_value::<CheckoutBranch>(input).unwrap()),
    )
    .await
    .map(|value| value.0)
}

#[tokio::test]
async fn switch_workspace_local_remote_new_preserves_identity_and_ownership() {
    let f = fixture().await;
    let r = &f.repositories[0];
    let path = Path::new(r.checkout_path.as_ref().unwrap());
    git(path, &["branch", "existing"]);
    std::fs::write(path.join("untracked.txt"), "keep").unwrap();
    let current = switch(
        &f,
        &r.id,
        serde_json::json!({"kind":"local","branch":"existing", "expected_branch":r.branch}),
    )
    .await
    .unwrap();
    assert_eq!(current.branch.as_deref(), Some("existing"));
    assert_eq!(current.branch_ownership, "user");
    assert_eq!(current.checkout_path, r.checkout_path);
    assert_eq!(
        std::fs::read_to_string(path.join("untracked.txt")).unwrap(),
        "keep"
    );
    assert_eq!(
        f.state
            .store
            .workspace_repository(&f.repositories[1].id)
            .await
            .unwrap()
            .branch,
        f.repositories[1].branch
    );
    let created = switch(&f, &r.id, serde_json::json!({"kind":"new","branch":"next"}))
        .await
        .unwrap();
    assert_eq!(created.branch_ownership, "managed");
    git(path, &["remote", "add", "origin", "/unused-local-remote"]);
    git(path, &["update-ref", "refs/remotes/origin/release", "HEAD"]);
    let remote = switch(&f, &r.id, serde_json::json!({"kind":"remote","branch":"release","remote":"origin", "local_branch":"tracking"})).await.unwrap();
    assert_eq!(remote.branch.as_deref(), Some("tracking"));
    assert_eq!(remote.remote_name.as_deref(), Some("origin"));
    assert_eq!(remote.remote_branch.as_deref(), Some("release"));
    assert_eq!(
        f.state
            .store
            .managed_workspace_branches(&r.id)
            .await
            .unwrap(),
        vec!["feature/batch", "next", "tracking"]
    );
    git(path, &["switch", "existing"]);
    let observed = f.state.store.workspace_repository(&r.id).await.unwrap();
    assert_eq!(observed.branch.as_deref(), Some("existing"));
    assert_eq!(observed.branch_ownership, "user");
    assert_eq!(observed.remote_name, None);
    let original = sqlx::query_scalar!(
        "SELECT creation_branch FROM workspace_repositories WHERE id=?",
        r.id
    )
    .fetch_one(&f.state.store.pool)
    .await
    .unwrap();
    assert_eq!(original, r.branch);
}

#[tokio::test]
async fn switch_rejects_stale_occupied_conflicting_and_invalid_targets() {
    let f = fixture().await;
    let r = &f.repositories[0];
    let path = Path::new(r.checkout_path.as_ref().unwrap());
    git(path, &["branch", "existing"]);
    for input in [
        serde_json::json!({"kind":"local","branch":"existing","expected_branch":"stale"}),
        serde_json::json!({"kind":"local","branch":"existing","expected_head":"stale"}),
        serde_json::json!({"kind":"local","branch":"main"}),
        serde_json::json!({"kind":"new","branch":"-bad"}),
        serde_json::json!({"kind":"new","branch":"existing"}),
    ] {
        assert!(switch(&f, &r.id, input).await.is_err());
    }
    git(path, &["branch", "older", "HEAD~1"]);
    std::fs::write(path.join("shared.txt"), "dirty").unwrap();
    assert!(
        switch(
            &f,
            &r.id,
            serde_json::json!({"kind":"local","branch":"older"})
        )
        .await
        .is_err()
    );
    assert_eq!(
        std::fs::read_to_string(path.join("shared.txt")).unwrap(),
        "dirty"
    );
    assert_eq!(
        git(path, &["branch", "--show-current"]),
        r.branch.as_ref().unwrap().as_str()
    );
}

#[tokio::test]
async fn fork_delivery_follows_parent_git_branch_and_switch_api_rejects_forks() {
    let f = fixture().await;
    let (_, Json(fork)) = create_fork(
        State(f.state.clone()),
        AxumPath(f.workspace.id.clone()),
        ApiJson(crate::server::fork::CreateFork {
            generated_branch: None,
            branch: Some("child".into()),
            description: None,
        }),
    )
    .await
    .unwrap();
    let children = f
        .state
        .store
        .workspace_repositories(&fork.id)
        .await
        .unwrap();
    let child = children
        .iter()
        .find(|r| r.project_repository_id == f.repositories[0].project_repository_id)
        .unwrap();
    assert!(
        switch(
            &f,
            &child.id,
            serde_json::json!({"kind":"new","branch":"forbidden"})
        )
        .await
        .is_err()
    );
    let parent = &f.repositories[0];
    switch(
        &f,
        &parent.id,
        serde_json::json!({"kind":"new","branch":"parent-new"}),
    )
    .await
    .unwrap();
    let (_, target) =
        crate::server::delivery::workspace_repository_delivery_target(&f.state, &fork, child)
            .await
            .unwrap();
    assert_eq!(target, "parent-new");
    git(
        Path::new(parent.checkout_path.as_ref().unwrap()),
        &["switch", "-c", "terminal-switch"],
    );
    let (_, target) =
        crate::server::delivery::workspace_repository_delivery_target(&f.state, &fork, child)
            .await
            .unwrap();
    assert_eq!(target, "terminal-switch");
}

#[tokio::test]
async fn cleanup_after_switch_deletes_only_managed_branches() {
    let f = fixture().await;
    let r = &f.repositories[0];
    let path = Path::new(r.checkout_path.as_ref().unwrap());
    git(path, &["branch", "user-retained"]);
    switch(
        &f,
        &r.id,
        serde_json::json!({"kind":"new","branch":"managed-next"}),
    )
    .await
    .unwrap();
    switch(
        &f,
        &r.id,
        serde_json::json!({"kind":"local","branch":"user-retained"}),
    )
    .await
    .unwrap();
    f.state
        .store
        .finish_workspace(&f.workspace.id, "kept", "skip", None, "now")
        .await
        .unwrap();
    let options = crate::server::workspace_delete::DeleteWorkspaceOptions {
        delete_worktrees: true,
        delete_branches: true,
        discard_token: None,
    };
    let preview = crate::server::workspace_delete::delete_precheck(
        State(f.state.clone()),
        AxumPath(f.workspace.id.clone()),
        Query(options.clone()),
    )
    .await
    .unwrap()
    .0;
    crate::server::workspace_delete::delete_workspace(
        State(f.state.clone()),
        AxumPath(f.workspace.id.clone()),
        Query(crate::server::workspace_delete::DeleteWorkspaceOptions {
            discard_token: preview.discard_token,
            ..options
        }),
    )
    .await
    .unwrap();
    assert_eq!(
        git(&f.roots[0], &["branch", "--list", "user-retained"]).trim(),
        "user-retained"
    );
    assert!(
        git(
            &f.roots[0],
            &["branch", "--list", "managed-next", "feature/batch"]
        )
        .is_empty()
    );
}

#[tokio::test]
async fn branch_switch_invalidates_same_head_delivery_preview() {
    let f = fixture().await;
    let confirmed = plans(&f).await;
    let r = &f.repositories[0];
    git(
        Path::new(r.checkout_path.as_ref().unwrap()),
        &["switch", "-c", "same-head"],
    );
    let plan = confirmed
        .iter()
        .find(|plan| plan.repository_id == r.id)
        .unwrap();
    assert!(verify_plan(&f.state, plan, false).await.is_err());
    assert!(verify_plan(&f.state, plan, true).await.is_err());
}

#[tokio::test]
async fn active_parent_operation_blocks_source_and_target_switches() {
    let f = fixture().await;
    let r = &f.repositories[0];
    commit(&f.roots[0], "shared.txt", "conflicting parent\n");
    let operation = crate::server::parent_operation::start_parent_operation_impl(
        &f.state,
        &r.id,
        "integrate",
        "merge",
        "standalone",
        None,
    )
    .await
    .unwrap();
    assert_eq!(operation.status, "conflicted");
    assert!(
        switch(
            &f,
            &r.id,
            serde_json::json!({"kind":"new","branch":"blocked"})
        )
        .await
        .is_err()
    );
    assert!(
        crate::server::branch_checkout::ensure_idle(
            &f.state,
            &r.project_repository_id,
            f.roots[0].to_str().unwrap()
        )
        .await
        .is_err()
    );
}

#[tokio::test]
async fn switching_keeps_explicit_upstreams_scoped_to_their_branch() {
    let f = fixture().await;
    let r = &f.repositories[0];
    f.state
        .store
        .update_workspace_delivery(&r.id, Some("origin"), Some("old-target"))
        .await
        .unwrap();
    let next = switch(
        &f,
        &r.id,
        serde_json::json!({"kind":"new","branch":"next", "base":{"kind":"local","branch":"main"}}),
    )
    .await
    .unwrap();
    assert_eq!(next.remote_name, None);
    assert_eq!(
        git(
            Path::new(next.checkout_path.as_ref().unwrap()),
            &["rev-parse", "HEAD"]
        ),
        git(&f.roots[0], &["rev-parse", "HEAD"])
    );
    switch(
        &f,
        &r.id,
        serde_json::json!({"kind":"local","branch":r.branch}),
    )
    .await
    .unwrap();
    assert_eq!(
        f.state
            .store
            .workspace_repository(&r.id)
            .await
            .unwrap()
            .remote_branch
            .as_deref(),
        Some("old-target")
    );
}
