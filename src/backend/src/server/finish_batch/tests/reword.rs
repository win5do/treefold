use super::*;
use crate::model::RewordRequest;

#[tokio::test]
async fn reword_api_checks_ownership_and_requires_shared_reference_confirmation() {
    let f = fixture().await;
    let location = &f.repositories[0];
    let path = Path::new(location.checkout_path.as_ref().unwrap());
    let head = git(path, &["rev-parse", "HEAD"]);
    git(path, &["update-ref", "refs/remotes/origin/feature", &head]);
    let Json(response) = crate::server::reword::workspace(
        State(f.state.clone()),
        AxumPath(location.id.clone()),
        ApiJson(RewordRequest::Preview {
            expected_head: head.clone(),
        }),
    )
    .await
    .unwrap();
    let preview = response.preview.unwrap();
    assert!(
        preview
            .shared_refs
            .contains(&"refs/remotes/origin/feature".into())
    );
    let apply = |confirmed_refs| RewordRequest::Apply {
        expected_head: head.clone(),
        expected_branch: preview.branch.clone(),
        message: "Edited workspace message".into(),
        confirmed_refs,
    };
    let Json(response) = crate::server::reword::workspace(
        State(f.state.clone()),
        AxumPath(location.id.clone()),
        ApiJson(apply(vec![])),
    )
    .await
    .unwrap();
    assert!(response.history.is_none());
    assert_eq!(git(path, &["rev-parse", "HEAD"]), head);
    let Json(response) = crate::server::reword::workspace(
        State(f.state.clone()),
        AxumPath(location.id.clone()),
        ApiJson(apply(preview.shared_refs.clone())),
    )
    .await
    .unwrap();
    assert_eq!(
        response.history.unwrap().commits[0].subject,
        "Edited workspace message"
    );
    f.state
        .store
        .finish_workspace_repository(&location.id, "kept", "keep", Some(&head), "closed")
        .await
        .unwrap();
    let rejected = crate::server::reword::workspace(
        State(f.state.clone()),
        AxumPath(location.id.clone()),
        ApiJson(RewordRequest::Preview {
            expected_head: git(path, &["rev-parse", "HEAD"]),
        }),
    )
    .await;
    assert!(rejected.is_err());
}

#[tokio::test]
async fn reword_project_allows_in_place_sessions_but_preserves_delivery_records() {
    let f = fixture().await;
    crate::server::sync_project_session_workspace(&f.state, &f.workspace.project_id)
        .await
        .unwrap();
    let id = f.repositories[0].project_repository_id.clone();
    let head = git(&f.roots[0], &["rev-parse", "HEAD"]);
    let Json(response) = crate::server::reword::project(
        State(f.state.clone()),
        AxumPath(id.clone()),
        ApiJson(RewordRequest::Preview {
            expected_head: head,
        }),
    )
    .await
    .unwrap();
    assert!(response.preview.is_some());
    let plans = squash_plans(&f, false).await;
    run_batch(
        &f.state,
        prepare_batch(&f.state, &f.workspace.id, plans)
            .await
            .unwrap(),
        false,
    )
    .await
    .unwrap();
    let result = crate::server::reword::project(
        State(f.state.clone()),
        AxumPath(id),
        ApiJson(RewordRequest::Preview {
            expected_head: git(&f.roots[0], &["rev-parse", "HEAD"]),
        }),
    )
    .await;
    assert!(matches!(
        result,
        Err(crate::server::AppError::Api {
            code: "REWORD_DELIVERY",
            ..
        })
    ));
}

#[tokio::test]
async fn squash_message_rejects_empty_and_reserved_marker_before_saving_plan() {
    let f = fixture().await;
    for message in ["  ", "Title\n\nTreefold-Squash: fake", "Title\0body"] {
        let mut plans = squash_plans(&f, false).await;
        plans[0].commit_message = Some(message.into());
        assert!(
            prepare_batch(&f.state, &f.workspace.id, plans)
                .await
                .is_err()
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
}
