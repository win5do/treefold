use super::*;
use crate::model::FinishBatch;

impl Store {
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
