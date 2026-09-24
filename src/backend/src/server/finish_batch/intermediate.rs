use super::super::parent_operation::{
    reconcile_parent_operation, release_parent_operation_recovery, start_parent_operation_impl,
};
use super::{AppState, FinishPlanItem, Result, verify_plan};

pub(super) async fn deliver(
    state: &AppState,
    plan: &FinishPlanItem,
    retry: bool,
) -> Result<Option<String>> {
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
