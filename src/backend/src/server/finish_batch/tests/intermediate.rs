use super::*;

async fn fork_fixture() -> (Fixture, String) {
    let mut f = fixture().await;
    let parent = f.workspace.id.clone();
    let created = crate::server::fork::create_fork_impl(
        f.state.clone(),
        parent.clone(),
        crate::server::fork::CreateFork {
            description: Some("Intermediate".into()),
            branch: Some("task/intermediate".into()),
            generated_branch: None,
        },
    )
    .await
    .unwrap();
    f.workspace = created.workspace;
    f.repositories = f
        .state
        .store
        .workspace_repositories(&f.workspace.id)
        .await
        .unwrap();
    (f, parent)
}
async fn retained_plans(f: &Fixture) -> Vec<FinishPlanItem> {
    plans(f)
        .await
        .into_iter()
        .map(|mut p| {
            p.delete_worktree = false;
            p.delete_branch = false;
            p
        })
        .collect()
}

#[tokio::test]
async fn intermediate_delivery_repeats_then_finishes_without_completing_todo_early() {
    let (f, parent_id) = fork_fixture().await;
    let todo = crate::model::Todo {
        id: crate::ids::new_id(),
        workspace_id: parent_id.clone(),
        content: "Continue".into(),
        status: "in_progress".into(),
        fork_id: Some(f.workspace.id.clone()),
        blocked_reason: None,
        created_at: crate::store::now(),
        updated_at: crate::store::now(),
    };
    f.state.store.create_todo(&todo).await.unwrap();
    let parents = f
        .state
        .store
        .workspace_repositories(&parent_id)
        .await
        .unwrap();
    let mut old_operation = String::new();
    for round in 1..=3 {
        for source in &f.repositories {
            commit(
                Path::new(source.checkout_path.as_ref().unwrap()),
                &format!("round-{round}.txt"),
                "delivery\n",
            );
        }
        let plan = retained_plans(&f).await;
        if round == 2 {
            let (status, _) = start_finish_batch(
                State(f.state.clone()),
                AxumPath(f.workspace.id.clone()),
                ApiJson(FinishBatchRequest {
                    continue_work: true,
                    repositories: plan,
                }),
            )
            .await
            .unwrap();
            assert_eq!(status, StatusCode::ACCEPTED);
            tokio::time::timeout(std::time::Duration::from_secs(15), async {
                while workers().lock().await.contains(&f.workspace.id) {
                    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                }
            })
            .await
            .unwrap();
        } else {
            let next = prepare_batch_with_mode(&f.state, &f.workspace.id, plan, round != 3)
                .await
                .unwrap();
            run_batch(&f.state, next, false).await.unwrap();
        }
        assert_eq!(saved(&f).await.status, "completed");
        for source in &f.repositories {
            let target = parents
                .iter()
                .find(|p| p.project_repository_id == source.project_repository_id)
                .unwrap();
            assert!(
                Path::new(target.checkout_path.as_ref().unwrap())
                    .join(format!("round-{round}.txt"))
                    .is_file()
            );
            assert!(Path::new(source.checkout_path.as_ref().unwrap()).is_dir());
            assert_eq!(
                f.state
                    .store
                    .workspace_repository(&source.id)
                    .await
                    .unwrap()
                    .delivery_status,
                if round == 3 { "delivered" } else { "active" }
            );
        }
        let operation = f
            .state
            .store
            .latest_parent_operation(&f.repositories[0].id, "integrate")
            .await
            .unwrap()
            .unwrap();
        assert_ne!(old_operation, operation.id);
        old_operation = operation.id;
        assert_eq!(
            f.state.store.todo(&todo.id).await.unwrap().status,
            if round == 3 { "done" } else { "in_progress" }
        );
        assert_eq!(
            f.state
                .store
                .workspace(&f.workspace.id)
                .await
                .unwrap()
                .status,
            if round == 3 { "archived" } else { "active" }
        );
    }
}

#[tokio::test]
async fn intermediate_delivery_rejects_squash_cleanup_skip_and_mixed_fork_strategies() {
    let (f, _) = fork_fixture().await;
    let plan = retained_plans(&f).await;
    for action in ["squash_merge", "keep", "skip"] {
        let mut invalid = plan.clone();
        invalid[0].code_action = action.into();
        assert!(
            prepare_batch_with_mode(&f.state, &f.workspace.id, invalid.clone(), true)
                .await
                .is_err()
        );
        if action != "skip" {
            assert!(
                prepare_batch(&f.state, &f.workspace.id, invalid)
                    .await
                    .is_err()
            );
        }
    }
    let mut invalid = plan;
    invalid[0].delete_worktree = true;
    assert!(
        prepare_batch_with_mode(&f.state, &f.workspace.id, invalid, true)
            .await
            .is_err()
    );
    let workspace = fixture().await;
    assert!(
        prepare_batch_with_mode(
            &workspace.state,
            &workspace.workspace.id,
            retained_plans(&workspace).await,
            true
        )
        .await
        .is_ok()
    );
}

#[tokio::test]
async fn intermediate_delivery_resumes_partial_batch_without_replaying_delivered_repository() {
    let (f, parent_id) = fork_fixture().await;
    for source in &f.repositories {
        commit(
            Path::new(source.checkout_path.as_ref().unwrap()),
            "next.txt",
            "next\n",
        );
    }
    let next = prepare_batch_with_mode(&f.state, &f.workspace.id, retained_plans(&f).await, true)
        .await
        .unwrap();
    let parents = f
        .state
        .store
        .workspace_repositories(&parent_id)
        .await
        .unwrap();
    let blocked = parents
        .iter()
        .find(|p| p.project_repository_id == f.repositories[1].project_repository_id)
        .unwrap()
        .checkout_path
        .as_ref()
        .unwrap();
    std::fs::write(Path::new(blocked).join("dirty.txt"), "dirty").unwrap();
    run_batch(&f.state, next, false).await.unwrap();
    let paused = saved(&f).await;
    assert_eq!(paused.status, "paused");
    assert!(paused.items[0].delivered);
    let first = f
        .state
        .store
        .latest_parent_operation(&f.repositories[0].id, "integrate")
        .await
        .unwrap()
        .unwrap()
        .id;
    std::fs::remove_file(Path::new(blocked).join("dirty.txt")).unwrap();
    run_batch(&f.state, paused, true).await.unwrap();
    assert_eq!(saved(&f).await.status, "completed");
    assert_eq!(
        first,
        f.state
            .store
            .latest_parent_operation(&f.repositories[0].id, "integrate")
            .await
            .unwrap()
            .unwrap()
            .id
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

#[test]
fn legacy_finish_batch_defaults_to_archiving() {
    let batch: FinishBatch = serde_json::from_value(
        serde_json::json!({"workspace_id":"legacy", "status":"paused", "items":[], "error":null}),
    )
    .unwrap();
    assert!(!batch.continue_work);
}

#[tokio::test]
async fn workspace_inherits_current_checkout_remote_pushes_repeatedly_and_reopens() {
    let mut f = fixture().await;
    for (index, root) in f.roots.iter().enumerate() {
        let bare = f._directory.path().join(format!("remote-{index}.git"));
        std::fs::create_dir_all(&bare).unwrap();
        git(&bare, &["init", "--bare"]);
        git(root, &["remote", "add", "upstream", bare.to_str().unwrap()]);
        git(root, &["push", "--set-upstream", "upstream", "main"]);
        // A stored Project preference must not override its checkout branch's remote.
        let repository = f
            .state
            .store
            .repository(&f.repositories[index].project_repository_id)
            .await
            .unwrap();
        f.state
            .store
            .update_repository(&repository.id, "", ".", Some(Some("obsolete")))
            .await
            .unwrap();
    }
    let (_, Json(workspace)) = create_workspace(
        State(f.state.clone()),
        AxumPath(f.workspace.project_id.clone()),
        ApiJson(CreateWorkspace {
            repository_remotes: None,
            expected_base_branches: None,
            generated_branch: None,
            description: None,
            branch: Some("feature/push-rounds".into()),
            remote_name: None,
            remote_branch: None,
        }),
    )
    .await
    .unwrap();
    f.workspace = workspace;
    f.repositories = f
        .state
        .store
        .workspace_repositories(&f.workspace.id)
        .await
        .unwrap();
    for repository in &f.repositories {
        assert_eq!(repository.remote_name.as_deref(), Some("upstream"));
        assert_eq!(
            repository.remote_branch.as_deref(),
            Some("feature/push-rounds")
        );
    }
    for round in 1..=2 {
        let mut plan = Vec::new();
        for repository in &f.repositories {
            let path = Path::new(repository.checkout_path.as_ref().unwrap());
            commit(path, &format!("push-{round}.txt"), "push\n");
            let (_, Json(preflight)) = create_workspace_repository_preflight_impl(
                f.state.clone(),
                repository.id.clone(),
                CreateDeliveryPreflight {
                    code_action: "push_branch".into(),
                },
            )
            .await
            .unwrap();
            plan.push(FinishPlanItem {
                repository_id: repository.id.clone(),
                code_action: "push_branch".into(),
                preflight_id: preflight.id,
                delete_worktree: false,
                delete_branch: false,
            });
        }
        let batch = prepare_batch_with_mode(&f.state, &f.workspace.id, plan, round == 1)
            .await
            .unwrap();
        run_batch(&f.state, batch, false).await.unwrap();
        assert_eq!(saved(&f).await.status, "completed");
        assert_eq!(
            f.state
                .store
                .workspace(&f.workspace.id)
                .await
                .unwrap()
                .status,
            if round == 1 { "active" } else { "archived" }
        );
        for repository in &f.repositories {
            let path = Path::new(repository.checkout_path.as_ref().unwrap());
            assert_eq!(
                git(path, &["rev-parse", "@{upstream}"]),
                git(path, &["rev-parse", "HEAD"])
            );
        }
    }
    crate::server::reopen::reopen_fork_impl(&f.state, &f.workspace.id)
        .await
        .unwrap();
    assert_eq!(
        f.state
            .store
            .workspace(&f.workspace.id)
            .await
            .unwrap()
            .status,
        "active"
    );
    assert!(
        f.state
            .store
            .finish_batch(&f.workspace.id)
            .await
            .unwrap()
            .is_none()
    );
}
