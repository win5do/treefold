#![allow(dead_code)] // Delivery compatibility helpers remain covered by integration tests.

use rusqlite::{Row, named_params, params};

use super::{Store, now};
use crate::{error::Result, model::*};

impl Store {
    pub fn todos(&self, workspace_id: &str) -> Result<Vec<Todo>> {
        let db = self.0.lock();
        let mut stmt = db.prepare(&format!(
            "SELECT {TODO_COLUMNS} FROM todos WHERE workspace_id=? ORDER BY created_at DESC"
        ))?;
        let values = stmt
            .query_map([workspace_id], todo_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(values)
    }

    pub fn create_todo(&self, t: &Todo) -> Result<()> {
        self.0.lock().execute(
            "INSERT INTO todos(id,workspace_id,content,status,fork_id,blocked_reason,created_at,updated_at)
             VALUES(:id,:workspace_id,:content,:status,:fork_id,:blocked_reason,:created_at,:updated_at)",
            named_params! {
                ":id": t.id,
                ":workspace_id": t.workspace_id,
                ":content": t.content,
                ":status": t.status,
                ":fork_id": t.fork_id,
                ":blocked_reason": t.blocked_reason,
                ":created_at": t.created_at,
                ":updated_at": t.updated_at,
            },
        )?;
        Ok(())
    }

    pub fn todo(&self, id: &str) -> Result<Todo> {
        Ok(self.0.lock().query_row(
            &format!("SELECT {TODO_COLUMNS} FROM todos WHERE id=?"),
            [id],
            todo_row,
        )?)
    }

    pub fn update_todo(&self, id: &str, status: &str) -> Result<()> {
        self.0.lock().execute(
            "UPDATE todos SET status=?,blocked_reason=CASE WHEN ?='blocked' THEN blocked_reason ELSE NULL END,updated_at=? WHERE id=?",
            params![status, status, now(), id],
        )?;
        Ok(())
    }

    pub fn edit_todo(&self, id: &str, content: Option<&str>) -> Result<()> {
        self.0.lock().execute(
            "UPDATE todos SET content=COALESCE(?,content),updated_at=? WHERE id=?",
            params![content, now(), id],
        )?;
        Ok(())
    }

    pub fn reserve_todo_for_fork(&self, id: &str) -> Result<bool> {
        let changed = self.0.lock().execute(
            "UPDATE todos SET status='in_progress',updated_at=?
             WHERE id=? AND status IN ('pending','blocked')",
            params![now(), id],
        )?;
        Ok(changed == 1)
    }

    pub fn attach_todo_fork(
        &self,
        id: &str,
        previous_fork_id: Option<&str>,
        fork_id: &str,
    ) -> Result<bool> {
        let changed = self.0.lock().execute(
            "UPDATE todos SET status='in_progress',fork_id=?,blocked_reason=NULL,updated_at=?
             WHERE id=? AND fork_id IS ?",
            params![fork_id, now(), id, previous_fork_id],
        )?;
        Ok(changed == 1)
    }

    pub fn restore_todo_after_fork_failure(
        &self,
        id: &str,
        previous_fork_id: Option<&str>,
        status: &str,
        blocked_reason: Option<&str>,
    ) -> Result<()> {
        self.0.lock().execute(
            "UPDATE todos SET status=?,blocked_reason=?,updated_at=?
             WHERE id=? AND status='in_progress' AND fork_id IS ?",
            params![status, blocked_reason, now(), id, previous_fork_id],
        )?;
        Ok(())
    }

    pub fn block_todo(&self, id: &str, reason: &str) -> Result<()> {
        self.0.lock().execute(
            "UPDATE todos SET status='blocked',blocked_reason=?,updated_at=? WHERE id=?",
            params![reason, now(), id],
        )?;
        Ok(())
    }

    pub fn delete_todo(&self, id: &str) -> Result<()> {
        self.0
            .lock()
            .execute("DELETE FROM todos WHERE id=?", [id])?;
        Ok(())
    }

    pub fn todo_for_fork(&self, fork_id: &str) -> Result<Option<Todo>> {
        let db = self.0.lock();
        let mut stmt = db.prepare(&format!("SELECT {TODO_COLUMNS} FROM todos WHERE fork_id=?"))?;
        let mut rows = stmt.query([fork_id])?;
        Ok(rows.next()?.map(todo_row).transpose()?)
    }
}

fn todo_row(r: &Row<'_>) -> rusqlite::Result<Todo> {
    Ok(Todo {
        id: r.get("id")?,
        workspace_id: r.get("workspace_id")?,
        content: r.get("content")?,
        status: r.get("status")?,
        fork_id: r.get("fork_id")?,
        blocked_reason: r.get("blocked_reason")?,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
    })
}

const TODO_COLUMNS: &str =
    "id,workspace_id,content,status,fork_id,blocked_reason,created_at,updated_at";
