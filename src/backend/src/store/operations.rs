#![allow(dead_code)]
use super::{Store, now};
use crate::{
    error::{AppError, Result},
    model::*,
};

pub(crate) struct ParentOperationUpdate<'a> {
    pub id: &'a str,
    pub status: &'a str,
    pub phase: &'a str,
    pub result_head: Option<&'a str>,
    pub error: &'a str,
    pub terminal: bool,
}

#[derive(sqlx::FromRow)]
struct DeliveryOperationRow {
    workspace_repository_id: String,
    phase: String,
    code_action: String,
    todo_action: String,
    push_after_merge: bool,
    keep_session_history: bool,
    delete_worktree: bool,
    delete_branch: bool,
    commit_message: String,
    before_head: String,
    source_head: String,
    target_head: String,
    integrated_commit: Option<String>,
    error: String,
    started_at: String,
    updated_at: String,
}
impl From<DeliveryOperationRow> for DeliveryOperation {
    fn from(r: DeliveryOperationRow) -> Self {
        Self {
            workspace_id: r.workspace_repository_id.clone(),
            workspace_repository_id: r.workspace_repository_id,
            phase: r.phase,
            code_action: r.code_action,
            todo_action: r.todo_action,
            push_after_merge: r.push_after_merge,
            keep_session_history: r.keep_session_history,
            delete_worktree: r.delete_worktree,
            delete_branch: r.delete_branch,
            commit_message: r.commit_message,
            before_head: r.before_head,
            source_head: r.source_head,
            target_head: r.target_head,
            integrated_commit: r.integrated_commit,
            error: r.error,
            started_at: r.started_at,
            updated_at: r.updated_at,
        }
    }
}
#[derive(sqlx::FromRow)]
struct ParentOperationRow {
    id: String,
    workspace_repository_id: String,
    workspace_id: String,
    direction: String,
    strategy: String,
    origin: String,
    source_repository_id: String,
    source_path: String,
    source_branch: String,
    target_scope: String,
    target_workspace_id: Option<String>,
    target_path: String,
    target_branch: String,
    source_head: String,
    parent_head: String,
    before_head: String,
    result_head: Option<String>,
    recovery_ref: String,
    status: String,
    phase: String,
    resolver_session_id: Option<String>,
    delivery_operation_id: Option<String>,
    error: String,
    started_at: String,
    updated_at: String,
    completed_at: Option<String>,
}
impl From<ParentOperationRow> for ParentOperation {
    fn from(r: ParentOperationRow) -> Self {
        Self {
            id: r.id,
            workspace_repository_id: r.workspace_repository_id,
            workspace_id: r.workspace_id,
            direction: r.direction,
            strategy: r.strategy,
            origin: r.origin,
            source_repository_id: r.source_repository_id,
            source_path: r.source_path,
            source_branch: r.source_branch,
            target_scope: r.target_scope,
            target_workspace_id: r.target_workspace_id,
            target_path: r.target_path,
            target_branch: r.target_branch,
            source_head: r.source_head,
            parent_head: r.parent_head,
            before_head: r.before_head,
            result_head: r.result_head,
            recovery_ref: r.recovery_ref,
            status: r.status,
            phase: r.phase,
            resolver_session_id: r.resolver_session_id,
            delivery_operation_id: r.delivery_operation_id,
            error: r.error,
            started_at: r.started_at,
            updated_at: r.updated_at,
            completed_at: r.completed_at,
        }
    }
}
#[derive(sqlx::FromRow)]
struct PreflightRow {
    id: String,
    workspace_repository_id: String,
    code_action: String,
    source_head: String,
    target_head: String,
    target_branch: String,
    source_status: String,
    source_dirty: bool,
    target_dirty: bool,
    ahead: i64,
    behind: i64,
    changed_files: String,
    commits: String,
    diff_stat: String,
    blockers: String,
    warnings: String,
    created_at: String,
}
impl TryFrom<PreflightRow> for DeliveryPreflight {
    type Error = AppError;
    fn try_from(r: PreflightRow) -> Result<Self> {
        Ok(Self {
            id: r.id,
            workspace_id: r.workspace_repository_id.clone(),
            workspace_repository_id: r.workspace_repository_id,
            code_action: r.code_action,
            source_head: r.source_head,
            target_head: r.target_head,
            target_branch: r.target_branch,
            source_status: r.source_status,
            source_dirty: r.source_dirty,
            target_dirty: r.target_dirty,
            ahead: r.ahead,
            behind: r.behind,
            changed_files: serde_json::from_str(&r.changed_files).map_err(anyhow::Error::from)?,
            commits: serde_json::from_str(&r.commits).map_err(anyhow::Error::from)?,
            diff_stat: r.diff_stat,
            blockers: serde_json::from_str(&r.blockers).map_err(anyhow::Error::from)?,
            warnings: serde_json::from_str(&r.warnings).map_err(anyhow::Error::from)?,
            created_at: r.created_at,
        })
    }
}
const DELIVERY: &str = "workspace_repository_id,phase,code_action,todo_action,push_after_merge,keep_session_history,delete_worktree,delete_branch,commit_message,before_head,source_head,target_head,integrated_commit,error,started_at,updated_at";
const PARENT: &str = "id,workspace_repository_id,workspace_id,direction,strategy,origin,source_repository_id,source_path,source_branch,target_scope,target_workspace_id,target_path,target_branch,source_head,parent_head,before_head,result_head,recovery_ref,status,phase,resolver_session_id,delivery_operation_id,error,started_at,updated_at,completed_at";
impl Store {
    pub async fn set_delivery_status(&self, id: &str, status: &str) -> Result<()> {
        let id = self.resolve_workspace_repository_id(id).await?;
        sqlx::query("UPDATE workspace_repositories SET delivery_status=?,updated_at=? WHERE id=?")
            .bind(status)
            .bind(now())
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
    pub async fn update_workspace_delivery(
        &self,
        id: &str,
        remote_name: Option<&str>,
        remote_branch: Option<&str>,
        delivery_mode: &str,
    ) -> Result<()> {
        let id = self.resolve_workspace_repository_id(id).await?;
        let r=sqlx::query("UPDATE workspace_repositories SET remote_name=?,remote_branch=?,delivery_mode=?,updated_at=? WHERE id=?").bind(remote_name).bind(remote_branch).bind(delivery_mode).bind(now()).bind(id).execute(&self.pool).await?;
        if r.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }
    pub async fn delivery_operation(&self, id: &str) -> Result<Option<DeliveryOperation>> {
        let id = self.resolve_workspace_repository_id(id).await?;
        let r: Option<DeliveryOperationRow> = sqlx::query_as(static_sql!(
            "SELECT {DELIVERY} FROM delivery_operations WHERE workspace_repository_id=?"
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(r.map(Into::into))
    }
    pub async fn create_delivery_operation(&self, o: &DeliveryOperation) -> Result<()> {
        sqlx::query("INSERT INTO delivery_operations(workspace_repository_id,phase,code_action,todo_action,push_after_merge,keep_session_history,delete_worktree,delete_branch,commit_message,before_head,source_head,target_head,integrated_commit,error,started_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(&o.workspace_repository_id).bind(&o.phase).bind(&o.code_action).bind(&o.todo_action).bind(o.push_after_merge).bind(o.keep_session_history).bind(o.delete_worktree).bind(o.delete_branch).bind(&o.commit_message).bind(&o.before_head).bind(&o.source_head).bind(&o.target_head).bind(&o.integrated_commit).bind(&o.error).bind(&o.started_at).bind(&o.updated_at).execute(&self.pool).await?;
        Ok(())
    }
    pub async fn advance_delivery(
        &self,
        id: &str,
        phase: &str,
        source_head: Option<&str>,
        target_head: Option<&str>,
        integrated_commit: Option<&str>,
    ) -> Result<()> {
        let id = self.resolve_workspace_repository_id(id).await?;
        sqlx::query("UPDATE delivery_operations SET phase=?,source_head=COALESCE(?,source_head),target_head=COALESCE(?,target_head),integrated_commit=COALESCE(?,integrated_commit),error='',updated_at=? WHERE workspace_repository_id=?").bind(phase).bind(source_head).bind(target_head).bind(integrated_commit).bind(now()).bind(id).execute(&self.pool).await?;
        Ok(())
    }
    pub async fn set_delivery_error(&self, id: &str, error: &str) -> Result<()> {
        let id = self.resolve_workspace_repository_id(id).await?;
        sqlx::query(
            "UPDATE delivery_operations SET error=?,updated_at=? WHERE workspace_repository_id=?",
        )
        .bind(error)
        .bind(now())
        .bind(id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
    async fn parent_optional(
        &self,
        sql: impl sqlx::SqlSafeStr,
        a: &str,
        b: Option<&str>,
    ) -> Result<Option<ParentOperation>> {
        let mut q = sqlx::query_as::<_, ParentOperationRow>(sql).bind(a);
        if let Some(b) = b {
            q = q.bind(b)
        }
        Ok(q.fetch_optional(&self.pool).await?.map(Into::into))
    }
    pub async fn parent_operation(&self, id: &str) -> Result<ParentOperation> {
        let r: ParentOperationRow = sqlx::query_as(static_sql!(
            "SELECT {PARENT} FROM parent_operations WHERE id=?"
        ))
        .bind(id)
        .fetch_one(&self.pool)
        .await?;
        Ok(r.into())
    }
    pub async fn latest_parent_operation(
        &self,
        id: &str,
        direction: &str,
    ) -> Result<Option<ParentOperation>> {
        self.parent_optional(static_sql!("SELECT {PARENT} FROM parent_operations WHERE workspace_repository_id=? AND direction=? ORDER BY updated_at DESC,rowid DESC LIMIT 1"),id,Some(direction)).await
    }
    /// Completed integrations remain ownership boundaries even when a newer
    /// operation failed or was aborted. Looking only at the latest row loses them.
    pub async fn has_completed_integration(&self, id: &str) -> Result<bool> {
        let row = sqlx::query!(
            "SELECT COUNT(*) AS count FROM parent_operations WHERE workspace_repository_id = ? AND direction = 'integrate' AND status = 'completed'",
            id
        ).fetch_one(&self.pool).await?;
        Ok(row.count > 0)
    }

    pub async fn active_parent_operation_for_target(
        &self,
        id: &str,
        path: &str,
    ) -> Result<Option<ParentOperation>> {
        self.parent_optional(static_sql!("SELECT {PARENT} FROM parent_operations WHERE source_repository_id=? AND target_path=? AND status IN ('active','conflicted','resolving','recovery_required') ORDER BY updated_at DESC,rowid DESC LIMIT 1"),id,Some(path)).await
    }

    pub async fn create_parent_operation(&self, o: &ParentOperation) -> Result<()> {
        sqlx::query("INSERT INTO parent_operations(id,workspace_repository_id,workspace_id,direction,strategy,origin,source_repository_id,source_path,source_branch,target_scope,target_workspace_id,target_path,target_branch,source_head,parent_head,before_head,result_head,recovery_ref,status,phase,resolver_session_id,delivery_operation_id,error,started_at,updated_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(&o.id).bind(&o.workspace_repository_id).bind(&o.workspace_id).bind(&o.direction).bind(&o.strategy).bind(&o.origin).bind(&o.source_repository_id).bind(&o.source_path).bind(&o.source_branch).bind(&o.target_scope).bind(&o.target_workspace_id).bind(&o.target_path).bind(&o.target_branch).bind(&o.source_head).bind(&o.parent_head).bind(&o.before_head).bind(&o.result_head).bind(&o.recovery_ref).bind(&o.status).bind(&o.phase).bind(&o.resolver_session_id).bind(&o.delivery_operation_id).bind(&o.error).bind(&o.started_at).bind(&o.updated_at).bind(&o.completed_at).execute(&self.pool).await?;
        Ok(())
    }
    pub async fn update_parent_operation(&self, u: ParentOperationUpdate<'_>) -> Result<()> {
        let t = now();
        sqlx::query("UPDATE parent_operations SET status=?,phase=?,result_head=COALESCE(?,result_head),error=?,updated_at=?,completed_at=CASE WHEN ? THEN COALESCE(completed_at,?) ELSE completed_at END WHERE id=?").bind(u.status).bind(u.phase).bind(u.result_head).bind(u.error).bind(&t).bind(u.terminal).bind(&t).bind(u.id).execute(&self.pool).await?;
        Ok(())
    }
    pub async fn set_parent_operation_resolver(&self, id: &str, session: &str) -> Result<()> {
        sqlx::query("UPDATE parent_operations SET resolver_session_id=?,status='resolving',phase='resolving',error='',updated_at=? WHERE id=?").bind(session).bind(now()).bind(id).execute(&self.pool).await?;
        Ok(())
    }
    pub async fn create_delivery_preflight(&self, p: &DeliveryPreflight) -> Result<()> {
        sqlx::query("INSERT INTO delivery_preflights(id,workspace_repository_id,code_action,source_head,target_head,target_branch,source_status,source_dirty,target_dirty,ahead,behind,changed_files,commits,diff_stat,blockers,warnings,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(&p.id).bind(&p.workspace_repository_id).bind(&p.code_action).bind(&p.source_head).bind(&p.target_head).bind(&p.target_branch).bind(&p.source_status).bind(p.source_dirty).bind(p.target_dirty).bind(p.ahead).bind(p.behind).bind(serde_json::to_string(&p.changed_files).map_err(anyhow::Error::from)?).bind(serde_json::to_string(&p.commits).map_err(anyhow::Error::from)?).bind(&p.diff_stat).bind(serde_json::to_string(&p.blockers).map_err(anyhow::Error::from)?).bind(serde_json::to_string(&p.warnings).map_err(anyhow::Error::from)?).bind(&p.created_at).execute(&self.pool).await?;
        Ok(())
    }
    pub async fn delivery_preflight(&self, id: &str) -> Result<DeliveryPreflight> {
        let r:PreflightRow=sqlx::query_as("SELECT id,workspace_repository_id,code_action,source_head,target_head,target_branch,source_status,source_dirty,target_dirty,ahead,behind,changed_files,commits,diff_stat,blockers,warnings,created_at FROM delivery_preflights WHERE id=?").bind(id).fetch_one(&self.pool).await?;
        r.try_into()
    }
}
