//! Assemble checkout snapshots from persistence and Git without persisting current HEAD.
use super::Store;
use crate::{error::Result, git, model::WorkspaceRepository};
use std::path::Path;

/// Persistence record; current branch and upstream are supplied by observation below.
#[derive(sqlx::FromRow)]
pub(super) struct WorkspaceRepositoryRecord {
    id: String,
    workspace_id: String,
    project_repository_id: String,
    repository_name: String,
    source_root: String,
    access_mode: String,
    git_status: String,
    creation_error: Option<String>,
    worktree_id: Option<String>,
    checkout_path: Option<String>,
    base_branch: Option<String>,
    start_commit: Option<String>,
    forked_from_commit: Option<String>,
    worktree_ownership: String,
    delivery_status: String,
    close_outcome: Option<String>,
    integrated_commit: Option<String>,
    closed_at: Option<String>,
    created_at: String,
    updated_at: String,
    creation_branch: Option<String>,
}

impl From<WorkspaceRepositoryRecord> for WorkspaceRepository {
    fn from(row: WorkspaceRepositoryRecord) -> Self {
        Self {
            id: row.id,
            workspace_id: row.workspace_id,
            project_repository_id: row.project_repository_id,
            repository_name: row.repository_name,
            source_root: row.source_root,
            access_mode: row.access_mode,
            git_status: row.git_status.clone(),
            creation_error: row.creation_error,
            worktree_id: row.worktree_id,
            checkout_path: row.checkout_path,
            base_branch: row.base_branch,
            start_commit: row.start_commit,
            forked_from_commit: row.forked_from_commit,
            worktree_ownership: row.worktree_ownership,
            delivery_status: row.delivery_status,
            close_outcome: row.close_outcome,
            integrated_commit: row.integrated_commit,
            closed_at: row.closed_at,
            created_at: row.created_at,
            updated_at: row.updated_at,
            branch: (row.git_status == "creating")
                .then_some(row.creation_branch)
                .flatten(),
            branch_ownership: "user".into(),
            remote_name: None,
            remote_branch: None,
        }
    }
}

impl Store {
    pub async fn checkout_has_active_operation(
        &self,
        repository_id: &str,
        path: &str,
    ) -> Result<bool> {
        Ok(sqlx::query!("SELECT id FROM parent_operations WHERE source_repository_id=? AND (source_path=? OR target_path=?) AND status IN ('active','conflicted','resolving','recovery_required') LIMIT 1", repository_id, path, path).fetch_optional(&self.pool).await?.is_some())
    }

    pub(super) async fn observe_workspace_repository(
        &self,
        record: WorkspaceRepositoryRecord,
    ) -> Result<WorkspaceRepository> {
        let mut row = WorkspaceRepository::from(record);
        // The stored branch is creation intent, only useful before checkout exists.
        if row.git_status != "creating" {
            row.branch = if let Some(path) = row.checkout_path.as_deref() {
                git::output_async(
                    Path::new(path),
                    &["symbolic-ref", "--quiet", "--short", "HEAD"],
                )
                .await
                .ok()
                .filter(|branch| !branch.is_empty())
            } else {
                None
            };
        }
        row.branch_ownership = "user".into();
        row.remote_name = None;
        row.remote_branch = None;
        if let Some(branch) = row.branch.as_deref() {
            let managed = sqlx::query!("SELECT branch FROM workspace_managed_branches WHERE workspace_repository_id=? AND branch=?", row.id, branch)
                .fetch_optional(&self.pool).await?.is_some();
            if managed {
                row.branch_ownership = "managed".into();
            }
            if let Some(upstream) = sqlx::query!("SELECT remote_name,remote_branch FROM workspace_branch_upstreams WHERE workspace_repository_id=? AND branch=?", row.id, branch)
                .fetch_optional(&self.pool).await? {
                // Explicit delivery overrides stay scoped to the selected branch.
                row.remote_name = upstream.remote_name;
                row.remote_branch = upstream.remote_branch;
            } else if let Some(path) = row.checkout_path.as_deref() {
                if let Ok(value) = git::output_async(Path::new(path), &["for-each-ref", "--format=%(upstream:remotename)%00%(upstream:remoteref)", &format!("refs/heads/{branch}")]).await {
                    if let Some((remote, reference)) = value.split_once('\0') {
                        if let Some(branch) = reference.strip_prefix("refs/heads/").filter(|_| !remote.is_empty()) {
                            row.remote_name = Some(remote.into());
                            row.remote_branch = Some(branch.into());
                        }
                    }
                }
            }
        }
        Ok(row)
    }

    pub(super) async fn observe_workspace_repositories(
        &self,
        rows: Vec<WorkspaceRepositoryRecord>,
    ) -> Result<Vec<WorkspaceRepository>> {
        let mut snapshots = Vec::with_capacity(rows.len());
        for row in rows {
            snapshots.push(self.observe_workspace_repository(row).await?);
        }
        Ok(snapshots)
    }

    pub async fn managed_workspace_branches(&self, id: &str) -> Result<Vec<String>> {
        Ok(sqlx::query_scalar!("SELECT branch FROM workspace_managed_branches WHERE workspace_repository_id=? ORDER BY branch", id).fetch_all(&self.pool).await?)
    }

    pub async fn track_workspace_branch(&self, id: &str, branch: &str) -> Result<()> {
        sqlx::query!("INSERT OR IGNORE INTO workspace_managed_branches(workspace_repository_id,branch) VALUES(?,?)", id, branch).execute(&self.pool).await?;
        Ok(())
    }
}
