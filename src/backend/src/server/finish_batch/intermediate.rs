use super::super::parent_operation::{
    reconcile_parent_operation, release_parent_operation_recovery, start_parent_operation_impl,
};
use super::{AppState, FinishPlanItem, Result, verify_plan};

pub(super) async fn deliver(
    state: &AppState,
    plan: &FinishPlanItem,
    retry: bool,
) -> Result<Option<String>> {
    if plan.code_action == "push_branch" {
        verify_plan(state, plan, retry).await?;
        let repository = state
            .store
            .workspace_repository(&plan.repository_id)
            .await?;
        let path = super::super::workspace_repository_git_path(&repository)?;
        let remote = repository.remote_name.as_deref().ok_or_else(|| {
            super::super::AppError::BadRequest(
                "Configure the Repository upstream before pushing".into(),
            )
        })?;
        let branch = repository.branch.as_deref().unwrap_or("");
        let target = repository.remote_branch.as_deref().unwrap_or("");
        super::super::command_output(
            std::path::Path::new(path),
            "git",
            &[
                "push",
                "--set-upstream",
                remote,
                &format!("{branch}:{target}"),
            ],
        )
        .map_err(super::super::AppError::BadRequest)?;
        super::super::fetch_remote_branch(path, remote, target)?;
        let confirmed = state.store.delivery_preflight(&plan.preflight_id).await?;
        if !super::super::git_is_ancestor(path, &confirmed.source_head, "FETCH_HEAD")? {
            return Err(super::super::AppError::BadRequest(
                "Remote feature branch does not contain the confirmed commit".into(),
            ));
        }
        return Ok(None);
    }
    // Resolve an existing conflict before retrying the confirmed plan.
    if let Some(operation) = state
        .store
        .latest_parent_operation(&plan.repository_id, "integrate")
        .await?
    {
        let operation = reconcile_parent_operation(state, &operation).await?;
        if matches!(
            operation.status.as_str(),
            "active" | "conflicted" | "resolving" | "recovery_required"
        ) {
            return Ok(Some(operation.id));
        }
    }
    verify_plan(state, plan, retry).await?;
    let operation = start_parent_operation_impl(
        state,
        &plan.repository_id,
        "integrate",
        "merge",
        "finish",
        Some(&plan.repository_id),
    )
    .await?;
    if operation.status != "completed" {
        return Ok(Some(operation.id));
    }
    release_parent_operation_recovery(state, &operation).await?;
    Ok(None)
}
