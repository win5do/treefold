use rusqlite::{named_params, params, Row};

use super::{now, Store};
use crate::{
    error::{AppError, Result},
    model::*,
};

impl Store {
    pub fn project_sessions(&self, project_id: &str) -> Result<Vec<Session>> {
        match self.project_session_workspace(project_id)? {
            Some(workspace) => self.sessions(&workspace.id),
            None => Ok(Vec::new()),
        }
    }

    pub fn sessions(&self, workspace_id: &str) -> Result<Vec<Session>> {
        let db = self.0.lock();
        let mut stmt = db.prepare(&format!(
            "SELECT {SESSION_COLUMNS} FROM sessions WHERE workspace_id=? ORDER BY sort_order ASC,created_at DESC"
        ))?;
        let mut values = stmt
            .query_map([workspace_id], session_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(stmt);
        drop(db);
        for session in &mut values {
            session.additional_directories = self.session_additional_directories(&session.id)?;
        }
        Ok(values)
    }

    pub fn session(&self, id: &str) -> Result<Session> {
        let db = self.0.lock();
        let mut value = db.query_row(
            &format!("SELECT {SESSION_COLUMNS} FROM sessions WHERE id=?"),
            [id],
            session_row,
        )?;
        drop(db);
        value.additional_directories = self.session_additional_directories(id)?;
        Ok(value)
    }

    pub fn create_session(&self, s: &Session) -> Result<()> {
        let mut db = self.0.lock();
        let tx = db.transaction()?;
        tx.execute(
            "INSERT INTO sessions(id,workspace_id,name,kind,cwd,original_cwd,initial_prompt,codex_session_id,sidebar_visible,hidden_at,evicted_at,process_id,process_name,status,pid,process_group_id,exit_code,exit_signal,command,launch_started_at,last_attached_at,created_at,updated_at)
             VALUES(:id,:workspace_id,:name,:kind,:cwd,:original_cwd,:initial_prompt,:codex_session_id,:sidebar_visible,:hidden_at,:evicted_at,:process_id,:process_name,:status,:pid,:process_group_id,:exit_code,:exit_signal,:command,:launch_started_at,:last_attached_at,:created_at,:updated_at)",
            named_params! {
                ":id": s.id,
                ":workspace_id": s.workspace_id,
                ":name": s.name,
                ":kind": s.kind,
                ":cwd": s.cwd,
                ":original_cwd": s.original_cwd,
                ":initial_prompt": s.initial_prompt,
                ":codex_session_id": s.codex_session_id,
                ":sidebar_visible": s.sidebar_visible,
                ":hidden_at": s.hidden_at,
                ":evicted_at": s.evicted_at,
                ":process_id": s.process_id,
                ":process_name": s.process_name,
                ":status": s.status,
                ":pid": s.pid,
                ":process_group_id": s.process_group_id,
                ":exit_code": s.exit_code,
                ":exit_signal": s.exit_signal,
                ":command": serde_json::to_string(&s.command).unwrap_or_default(),
                ":launch_started_at": s.launch_started_at,
                ":last_attached_at": s.last_attached_at,
                ":created_at": s.created_at,
                ":updated_at": s.updated_at,
            },
        )?;
        for path in &s.additional_directories {
            tx.execute(
                "INSERT INTO session_additional_directories(session_id,path) VALUES(:session_id,:path)",
                named_params! { ":session_id": s.id, ":path": path },
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_session_process_runtime(
        &self,
        id: &str,
        process_id: &str,
        process_name: &str,
        status: &str,
        pid: i64,
        process_group_id: i64,
        exit_code: Option<i64>,
        exit_signal: &str,
        command: &[String],
    ) -> Result<()> {
        self.0.lock().execute(
            "UPDATE sessions SET process_id=?,process_name=?,status=?,pid=?,process_group_id=?,exit_code=?,exit_signal=?,command=?,updated_at=? WHERE id=?",
            params![
                process_id,
                process_name,
                status,
                pid,
                process_group_id,
                exit_code,
                exit_signal,
                serde_json::to_string(command).unwrap_or_default(),
                now(),
                id
            ],
        )?;
        Ok(())
    }

    pub fn set_session_visible(&self, id: &str, visible: bool) -> Result<()> {
        let timestamp = now();
        self.0.lock().execute(
            "UPDATE sessions SET sidebar_visible=?,hidden_at=?,updated_at=? WHERE id=?",
            params![
                visible,
                if visible {
                    None::<String>
                } else {
                    Some(timestamp.clone())
                },
                timestamp,
                id
            ],
        )?;
        Ok(())
    }

    pub fn rename_session(&self, id: &str, name: &str) -> Result<()> {
        let changed = self.0.lock().execute(
            "UPDATE sessions SET name=?,updated_at=? WHERE id=?",
            params![name, now(), id],
        )?;
        if changed == 0 {
            return Err(crate::error::AppError::NotFound);
        }
        Ok(())
    }

    pub fn reorder_sessions(&self, workspace_id: &str, session_ids: &[String]) -> Result<()> {
        let mut db = self.0.lock();
        let tx = db.transaction()?;
        for (sort_order, id) in session_ids.iter().enumerate() {
            let changed = tx.execute(
                "UPDATE sessions SET sort_order=?,updated_at=? WHERE id=? AND workspace_id=?",
                params![sort_order as i64, now(), id, workspace_id],
            )?;
            if changed == 0 {
                return Err(AppError::BadRequest(
                    "every Session must belong to the target Workspace".into(),
                ));
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn touch_session(&self, id: &str) -> Result<()> {
        let timestamp = now();
        self.0.lock().execute(
            "UPDATE sessions SET last_attached_at=?,updated_at=? WHERE id=?",
            params![timestamp, timestamp, id],
        )?;
        Ok(())
    }

    pub fn set_codex_session_id(&self, id: &str, codex_session_id: &str) -> Result<()> {
        self.0.lock().execute(
            "UPDATE sessions SET codex_session_id=?,updated_at=? WHERE id=?",
            params![codex_session_id, now(), id],
        )?;
        Ok(())
    }

    pub fn delete_session(&self, id: &str) -> Result<()> {
        self.0
            .lock()
            .execute("DELETE FROM sessions WHERE id=?", [id])?;
        Ok(())
    }

    pub fn finalize_sessions(
        &self,
        workspace_id: &str,
        resume_cwd: &str,
        keep_history: bool,
    ) -> Result<()> {
        let timestamp = now();
        let db = self.0.lock();
        if keep_history {
            db.execute(
                "DELETE FROM sessions WHERE workspace_id=? AND kind='shell'",
                [workspace_id],
            )?;
            db.execute("UPDATE sessions SET cwd=?,sidebar_visible=0,hidden_at=?,status='closed',pid=0,updated_at=? WHERE workspace_id=? AND kind='codex'", params![resume_cwd,timestamp,timestamp,workspace_id])?;
        } else {
            db.execute("DELETE FROM sessions WHERE workspace_id=?", [workspace_id])?;
        }
        Ok(())
    }

    fn session_additional_directories(&self, id: &str) -> Result<Vec<String>> {
        let db = self.0.lock();
        let mut stmt = db.prepare(
            "SELECT path FROM session_additional_directories WHERE session_id=? AND access_mode='read_write' ORDER BY path",
        )?;
        let values = stmt
            .query_map([id], |r| r.get("path"))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(values)
    }

    pub fn replace_session_additional_directories(&self, id: &str, paths: &[String]) -> Result<()> {
        let mut db = self.0.lock();
        let tx = db.transaction()?;
        tx.execute(
            "DELETE FROM session_additional_directories WHERE session_id=? AND access_mode='read_write'",
            [id],
        )?;
        for path in paths {
            tx.execute(
                "INSERT INTO session_additional_directories(session_id,path) VALUES(:session_id,:path)",
                named_params! { ":session_id": id, ":path": path },
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn add_session_read_only_contexts(&self, id: &str, paths: &[String]) -> Result<()> {
        let mut db = self.0.lock();
        let tx = db.transaction()?;
        for path in paths {
            tx.execute(
                "INSERT OR REPLACE INTO session_additional_directories(session_id,path,access_mode) VALUES(:session_id,:path,'read_only')",
                named_params! { ":session_id": id, ":path": path },
            )?;
        }
        tx.commit()?;
        Ok(())
    }
}

const SESSION_COLUMNS: &str = "id,workspace_id,name,kind,cwd,original_cwd,initial_prompt,codex_session_id,sidebar_visible,hidden_at,evicted_at,process_id,process_name,status,pid,process_group_id,exit_code,exit_signal,command,launch_started_at,last_attached_at,created_at,updated_at";
fn session_row(r: &Row<'_>) -> rusqlite::Result<Session> {
    let command: String = r.get("command")?;
    Ok(Session {
        id: r.get("id")?,
        workspace_id: r.get("workspace_id")?,
        name: r.get("name")?,
        kind: r.get("kind")?,
        cwd: r.get("cwd")?,
        original_cwd: r.get("original_cwd")?,
        initial_prompt: r.get("initial_prompt")?,
        codex_session_id: r.get("codex_session_id")?,
        sidebar_visible: r.get("sidebar_visible")?,
        hidden_at: r.get("hidden_at")?,
        evicted_at: r.get("evicted_at")?,
        process_id: r.get("process_id")?,
        process_name: r.get("process_name")?,
        status: r.get("status")?,
        pid: r.get("pid")?,
        process_group_id: r.get("process_group_id")?,
        exit_code: r.get("exit_code")?,
        exit_signal: r.get("exit_signal")?,
        command: serde_json::from_str(&command).unwrap_or_default(),
        launch_started_at: r.get("launch_started_at")?,
        last_attached_at: r.get("last_attached_at")?,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
        additional_directories: vec![],
    })
}
