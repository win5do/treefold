#![allow(dead_code)]

use super::{Store, now};
use crate::{error::Result, model::Todo};

impl Store {
    pub async fn todos(&self, workspace_id: &str) -> Result<Vec<Todo>> {
        Ok(sqlx::query_as!(
            Todo,
            "SELECT id AS 'id!',workspace_id AS 'workspace_id!',content AS 'content!',status AS 'status!',fork_id,blocked_reason,created_at AS 'created_at!',updated_at AS 'updated_at!' FROM todos WHERE workspace_id=? ORDER BY created_at DESC",
            workspace_id
        )
        .fetch_all(&self.pool)
        .await?)
    }
    pub async fn create_todo(&self, t: &Todo) -> Result<()> {
        sqlx::query!(
            "INSERT INTO todos(id,workspace_id,content,status,fork_id,blocked_reason,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
            t.id,
            t.workspace_id,
            t.content,
            t.status,
            t.fork_id,
            t.blocked_reason,
            t.created_at,
            t.updated_at
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }
    pub async fn todo(&self, id: &str) -> Result<Todo> {
        Ok(sqlx::query_as!(Todo, "SELECT id AS 'id!',workspace_id AS 'workspace_id!',content AS 'content!',status AS 'status!',fork_id,blocked_reason,created_at AS 'created_at!',updated_at AS 'updated_at!' FROM todos WHERE id=?", id)
            .fetch_one(&self.pool)
            .await?)
    }
    pub async fn update_todo(&self, id: &str, status: &str) -> Result<()> {
        sqlx::query!("UPDATE todos SET status=?,blocked_reason=CASE WHEN ?='blocked' THEN blocked_reason ELSE NULL END,updated_at=? WHERE id=?", status, status, now(), id).execute(&self.pool).await?;
        Ok(())
    }
    pub async fn edit_todo(&self, id: &str, content: Option<&str>) -> Result<()> {
        sqlx::query!(
            "UPDATE todos SET content=COALESCE(?,content),updated_at=? WHERE id=?",
            content,
            now(),
            id
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }
    pub async fn reserve_todo_for_fork(&self, id: &str) -> Result<bool> {
        Ok(sqlx::query!("UPDATE todos SET status='in_progress',updated_at=? WHERE id=? AND status IN ('pending','blocked')", now(), id).execute(&self.pool).await?.rows_affected() == 1)
    }
    pub async fn attach_todo_fork(
        &self,
        id: &str,
        previous_fork_id: Option<&str>,
        fork_id: &str,
    ) -> Result<bool> {
        Ok(sqlx::query!("UPDATE todos SET status='in_progress',fork_id=?,blocked_reason=NULL,updated_at=? WHERE id=? AND fork_id IS ?", fork_id, now(), id, previous_fork_id).execute(&self.pool).await?.rows_affected() == 1)
    }
    pub async fn restore_todo_after_fork_failure(
        &self,
        id: &str,
        previous_fork_id: Option<&str>,
        status: &str,
        blocked_reason: Option<&str>,
    ) -> Result<()> {
        sqlx::query!("UPDATE todos SET status=?,blocked_reason=?,updated_at=? WHERE id=? AND status='in_progress' AND fork_id IS ?", status, blocked_reason, now(), id, previous_fork_id).execute(&self.pool).await?;
        Ok(())
    }
    pub async fn block_todo(&self, id: &str, reason: &str) -> Result<()> {
        sqlx::query!(
            "UPDATE todos SET status='blocked',blocked_reason=?,updated_at=? WHERE id=?",
            reason,
            now(),
            id
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }
    pub async fn delete_todo(&self, id: &str) -> Result<()> {
        sqlx::query!("DELETE FROM todos WHERE id=?", id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
    pub async fn todo_for_fork(&self, fork_id: &str) -> Result<Option<Todo>> {
        Ok(sqlx::query_as!(Todo, "SELECT id AS 'id!',workspace_id AS 'workspace_id!',content AS 'content!',status AS 'status!',fork_id,blocked_reason,created_at AS 'created_at!',updated_at AS 'updated_at!' FROM todos WHERE fork_id=?", fork_id)
            .fetch_optional(&self.pool)
            .await?)
    }
}
