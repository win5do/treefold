use super::*;
use crate::model::FinishBatch;

impl Store {
    pub async fn has_squash_delivery(&self, id: &str) -> Result<bool> {
        let row = sqlx::query!("SELECT COUNT(*) AS count FROM parent_operations WHERE workspace_id=? AND direction='integrate' AND strategy='squash' AND status='completed'", id).fetch_one(&self.pool).await?;
        Ok(row.count > 0)
    }

    pub async fn complete_intermediate_batch(&self, batch: &FinishBatch) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        let id = &batch.workspace_id;
        let state =
            serde_json::to_string(batch).map_err(|error| AppError::Internal(error.into()))?;
        // Keep the journal, but the next delivery must use a fresh operation.
        sqlx::query!("UPDATE parent_operations SET phase='reopened' WHERE workspace_id=? AND direction='integrate' AND status='completed'", id).execute(&mut *tx).await?;
        sqlx::query!("INSERT INTO workspace_finish_batches (workspace_id, state) VALUES (?, ?) ON CONFLICT(workspace_id) DO UPDATE SET state = excluded.state", id, state).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn reopen_fork(&self, id: &str) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        let timestamp = now();
        let changed = sqlx::query!("UPDATE workspaces SET status='active', updated_at=? WHERE id=? AND kind='fork' AND status='archived' AND EXISTS (SELECT 1 FROM workspaces parent WHERE parent.id=workspaces.parent_workspace_id AND parent.status='active') AND EXISTS (SELECT 1 FROM projects WHERE projects.id=workspaces.project_id AND projects.status='active')", timestamp, id)
            .execute(&mut *tx).await?;
        if changed.rows_affected() != 1 {
            return Err(AppError::BadRequest(
                "Fork is no longer available to reopen".into(),
            ));
        }
        sqlx::query!("UPDATE workspace_repositories SET delivery_status='active', close_outcome=NULL, integrated_commit=NULL, closed_at=NULL, updated_at=? WHERE workspace_id=?", timestamp, id).execute(&mut *tx).await?;
        // Keep historical operations, but never reuse a prior delivery as this round's result.
        sqlx::query!("UPDATE parent_operations SET phase='reopened' WHERE workspace_id=? AND status='completed'", id).execute(&mut *tx).await?;
        sqlx::query!(
            "DELETE FROM workspace_finish_batches WHERE workspace_id=?",
            id
        )
        .execute(&mut *tx)
        .await?;
        sqlx::query!("DELETE FROM delivery_operations WHERE workspace_repository_id IN (SELECT id FROM workspace_repositories WHERE workspace_id=?)", id).execute(&mut *tx).await?;
        sqlx::query!("DELETE FROM delivery_preflights WHERE workspace_repository_id IN (SELECT id FROM workspace_repositories WHERE workspace_id=?)", id).execute(&mut *tx).await?;
        sqlx::query!(
            "UPDATE todos SET status='in_progress', blocked_reason=NULL, updated_at=? WHERE fork_id=?",
            timestamp,
            id
        )
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn finish_batch(&self, id: &str) -> Result<Option<FinishBatch>> {
        let row = sqlx::query!(
            "SELECT state FROM workspace_finish_batches WHERE workspace_id = ?",
            id
        )
        .fetch_optional(&self.pool)
        .await?;
        row.map(|row| {
            serde_json::from_str(&row.state).map_err(|error| AppError::Internal(error.into()))
        })
        .transpose()
    }

    pub async fn save_finish_batch(&self, batch: &FinishBatch) -> Result<()> {
        let state =
            serde_json::to_string(batch).map_err(|error| AppError::Internal(error.into()))?;
        let id = &batch.workspace_id;
        sqlx::query!("INSERT INTO workspace_finish_batches (workspace_id, state) VALUES (?, ?) ON CONFLICT(workspace_id) DO UPDATE SET state = excluded.state", id, state)
            .execute(&self.pool).await?;
        Ok(())
    }
}
