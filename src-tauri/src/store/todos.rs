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
            "INSERT INTO todos(id,workspace_id,title,description,status,session_id,blocked_reason,created_at,updated_at)
             VALUES(:id,:workspace_id,:title,:description,:status,:session_id,:blocked_reason,:created_at,:updated_at)",
            named_params! {
                ":id": t.id,
                ":workspace_id": t.workspace_id,
                ":title": t.title,
                ":description": t.description,
                ":status": t.status,
                ":session_id": t.session_id,
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

    pub fn update_todo(&self, id: &str, status: &str, session_id: Option<&str>) -> Result<()> {
        self.0.lock().execute(
            "UPDATE todos SET status=?,session_id=?,blocked_reason=NULL,updated_at=? WHERE id=?",
            params![status, session_id, now(), id],
        )?;
        Ok(())
    }

    pub fn edit_todo(
        &self,
        id: &str,
        title: Option<&str>,
        description: Option<&str>,
    ) -> Result<()> {
        self.0.lock().execute(
            "UPDATE todos SET title=COALESCE(?,title),description=COALESCE(?,description),updated_at=? WHERE id=?",
            params![title, description, now(), id],
        )?;
        Ok(())
    }

    pub fn claim_todo(&self, id: &str, session_id: &str) -> Result<bool> {
        let changed = self.0.lock().execute(
            "UPDATE todos SET status='assigned',session_id=?,blocked_reason=NULL,updated_at=?
             WHERE id=? AND (status='pending' OR (status='assigned' AND session_id=?))",
            params![session_id, now(), id, session_id],
        )?;
        Ok(changed == 1)
    }

    pub fn block_todo(&self, id: &str, session_id: &str, reason: &str) -> Result<()> {
        self.0.lock().execute(
            "UPDATE todos SET status='blocked',session_id=?,blocked_reason=?,updated_at=? WHERE id=?",
            params![session_id, reason, now(), id],
        )?;
        Ok(())
    }

    pub fn delete_todo(&self, id: &str) -> Result<()> {
        self.0
            .lock()
            .execute("DELETE FROM todos WHERE id=?", [id])?;
        Ok(())
    }

    pub fn delete_todos(&self, workspace_id: &str) -> Result<()> {
        self.0
            .lock()
            .execute("DELETE FROM todos WHERE workspace_id=?", [workspace_id])?;
        Ok(())
    }

    pub fn carry_todos(&self, from_workspace_id: &str, to_workspace_id: &str) -> Result<()> {
        self.0.lock().execute(
            "UPDATE todos
             SET workspace_id=?,session_id=NULL,blocked_reason=NULL,
                 status=CASE WHEN status IN ('assigned','in_progress','blocked') THEN 'pending' ELSE status END,
                 updated_at=?
             WHERE workspace_id=?",
            params![to_workspace_id, now(), from_workspace_id],
        )?;
        Ok(())
    }
}

fn todo_row(r: &Row<'_>) -> rusqlite::Result<Todo> {
    Ok(Todo {
        id: r.get("id")?,
        workspace_id: r.get("workspace_id")?,
        title: r.get("title")?,
        description: r.get("description")?,
        status: r.get("status")?,
        session_id: r.get("session_id")?,
        blocked_reason: r.get("blocked_reason")?,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
    })
}

const TODO_COLUMNS: &str =
    "id,workspace_id,title,description,status,session_id,blocked_reason,created_at,updated_at";
