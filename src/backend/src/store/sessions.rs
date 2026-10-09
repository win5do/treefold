#![allow(dead_code)]

use super::{Store, now};
use crate::{
    error::{AppError, Result},
    model::Session,
};

const SESSION_COLUMNS: &str = "id,workspace_id,name,name_is_custom,terminal_title,kind,cwd,original_cwd,initial_prompt,agent_session_id,visibility,hidden_at,evicted_at,amux_workspace_name,amux_process_name,status,exit_code,exit_signal,argv,io_mode,launch_started_at,last_attached_at,created_at,updated_at";

#[derive(sqlx::FromRow)]
struct SessionRow {
    id: String,
    workspace_id: String,
    name: String,
    name_is_custom: bool,
    terminal_title: Option<String>,
    kind: String,
    cwd: String,
    original_cwd: String,
    initial_prompt: String,
    agent_session_id: Option<String>,
    visibility: String,
    hidden_at: Option<String>,
    evicted_at: Option<String>,
    amux_workspace_name: String,
    amux_process_name: String,
    status: String,
    exit_code: Option<i64>,
    exit_signal: String,
    argv: String,
    io_mode: String,
    launch_started_at: String,
    last_attached_at: Option<String>,
    created_at: String,
    updated_at: String,
}
impl From<SessionRow> for Session {
    fn from(r: SessionRow) -> Self {
        Self {
            id: r.id,
            workspace_id: r.workspace_id,
            name: r.name,
            name_is_custom: r.name_is_custom,
            terminal_title: r.terminal_title,
            kind: r.kind,
            cwd: r.cwd,
            original_cwd: r.original_cwd,
            initial_prompt: r.initial_prompt,
            agent_session_id: r.agent_session_id,
            visibility: r.visibility,
            hidden_at: r.hidden_at,
            evicted_at: r.evicted_at,
            amux_workspace_name: r.amux_workspace_name,
            amux_process_name: r.amux_process_name,
            status: r.status,
            exit_code: r.exit_code,
            exit_signal: r.exit_signal,
            argv: serde_json::from_str(&r.argv).unwrap_or_default(),
            io_mode: r.io_mode,
            launch_started_at: r.launch_started_at,
            last_attached_at: r.last_attached_at,
            created_at: r.created_at,
            updated_at: r.updated_at,
            additional_directories: vec![],
        }
    }
}

impl Store {
    async fn session_rows(&self, sql: &str, bind: &str) -> Result<Vec<Session>> {
        Ok(sqlx::query_as::<_, SessionRow>(sqlx::AssertSqlSafe(sql))
            .bind(bind)
            .fetch_all(&self.pool)
            .await?
            .into_iter()
            .map(|row| self.with_title(row.into()))
            .collect())
    }
    pub async fn session_workspace_candidates(&self) -> Result<Vec<(String, String)>> {
        Ok(sqlx::query_as("SELECT wr.workspace_id,COALESCE(wr.checkout_path,wr.source_root) FROM workspace_repositories wr JOIN workspaces w ON w.id=wr.workspace_id JOIN projects p ON p.id=w.project_id WHERE w.status='active' AND p.status='active'").fetch_all(&self.pool).await?)
    }
    pub async fn project_sessions(&self, project_id: &str) -> Result<Vec<Session>> {
        match self.project_session_workspace(project_id).await? {
            Some(w) => self.sessions(&w.id).await,
            None => Ok(vec![]),
        }
    }
    pub async fn sessions(&self, workspace_id: &str) -> Result<Vec<Session>> {
        let sql = format!(
            "SELECT {SESSION_COLUMNS} FROM sessions WHERE workspace_id=? ORDER BY sort_order ASC,created_at DESC"
        );
        let mut values = self.session_rows(&sql, workspace_id).await?;
        for session in &mut values {
            session.additional_directories =
                self.session_additional_directories(&session.id).await?;
        }
        Ok(values)
    }
    pub async fn session(&self, id: &str) -> Result<Session> {
        let sql = format!("SELECT {SESSION_COLUMNS} FROM sessions WHERE id=?");
        let row: SessionRow = sqlx::query_as(sqlx::AssertSqlSafe(sql))
            .bind(id)
            .fetch_one(&self.pool)
            .await?;
        let mut value: Session = row.into();
        value.additional_directories = self.session_additional_directories(id).await?;
        Ok(self.with_title(value))
    }
    pub async fn create_session(&self, s: &Session) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        let title_handled = s.name_is_custom;
        sqlx::query("INSERT INTO sessions(id,workspace_id,name,kind,cwd,original_cwd,initial_prompt,agent_session_id,visibility,hidden_at,evicted_at,amux_workspace_name,amux_process_name,status,exit_code,exit_signal,argv,io_mode,launch_started_at,last_attached_at,created_at,updated_at,name_is_custom) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
            .bind(&s.id).bind(&s.workspace_id).bind(&s.name).bind(&s.kind).bind(&s.cwd).bind(&s.original_cwd)
            .bind(&s.initial_prompt).bind(&s.agent_session_id).bind(&s.visibility).bind(&s.hidden_at).bind(&s.evicted_at)
            .bind(&s.amux_workspace_name).bind(&s.amux_process_name).bind(&s.status).bind(s.exit_code).bind(&s.exit_signal)
            .bind(serde_json::to_string(&s.argv).unwrap_or_default()).bind(&s.io_mode).bind(&s.launch_started_at)
            .bind(&s.last_attached_at).bind(&s.created_at).bind(&s.updated_at).bind(title_handled).execute(&mut *tx).await?;
        for path in &s.additional_directories {
            sqlx::query("INSERT INTO session_additional_directories(session_id,path) VALUES(?,?)")
                .bind(&s.id)
                .bind(path)
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        Ok(())
    }
    pub async fn set_session_runtime(
        &self,
        id: &str,
        status: &str,
        exit_code: Option<i64>,
        exit_signal: &str,
        argv: &[String],
    ) -> Result<bool> {
        let argv = serde_json::to_string(argv).unwrap_or_default();
        Ok(sqlx::query("UPDATE sessions SET status=?,exit_code=?,exit_signal=?,argv=?,updated_at=? WHERE id=? AND (status IS NOT ? OR exit_code IS NOT ? OR exit_signal IS NOT ? OR argv IS NOT ?)")
            .bind(status).bind(exit_code).bind(exit_signal).bind(&argv).bind(now()).bind(id).bind(status).bind(exit_code).bind(exit_signal).bind(&argv).execute(&self.pool).await?.rows_affected()!=0)
    }
    pub async fn reconcile_session_runtime(
        &self,
        id: &str,
        status: &str,
        exit_code: Option<i64>,
        exit_signal: &str,
        argv: &[String],
    ) -> Result<bool> {
        let argv = serde_json::to_string(argv).unwrap_or_default();
        let timestamp = now();
        // Compare against the row at write time: an event snapshot can predate Stop.
        Ok(sqlx::query!(
            "UPDATE sessions SET
                status=CASE WHEN status='stopped' AND ?1 IN ('exited','failed') THEN status ELSE ?1 END,
                exit_code=?2,exit_signal=?3,argv=?4,updated_at=?5
             WHERE id=?6 AND (
                status IS NOT CASE WHEN status='stopped' AND ?1 IN ('exited','failed') THEN status ELSE ?1 END
                OR exit_code IS NOT ?2 OR exit_signal IS NOT ?3 OR argv IS NOT ?4)",
            status, exit_code, exit_signal, argv, timestamp, id
        )
        .execute(&self.pool)
        .await?
        .rows_affected() != 0)
    }
    pub async fn set_session_visibility(&self, id: &str, visibility: &str) -> Result<()> {
        let timestamp = now();
        let hidden = if visibility == "visible" {
            None
        } else {
            Some(timestamp.clone())
        };
        sqlx::query("UPDATE sessions SET visibility=?,hidden_at=?,updated_at=? WHERE id=?")
            .bind(visibility)
            .bind(hidden)
            .bind(timestamp)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
    pub async fn set_session_status(&self, id: &str, status: &str) -> Result<()> {
        sqlx::query("UPDATE sessions SET status=?,updated_at=? WHERE id=?")
            .bind(status)
            .bind(now())
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
    pub async fn stop_active_sessions(&self) -> Result<()> {
        sqlx::query("UPDATE sessions SET status='stopped',updated_at=? WHERE status='running'")
            .bind(now())
            .execute(&self.pool)
            .await?;
        Ok(())
    }
    pub async fn running_session_identities(&self) -> Result<Vec<(String, String, String)>> {
        Ok(sqlx::query_as(
            "SELECT id,amux_workspace_name,amux_process_name FROM sessions WHERE status='running'",
        )
        .fetch_all(&self.pool)
        .await?)
    }
    pub async fn session_by_amux_identity(
        &self,
        workspace: &str,
        process: &str,
    ) -> Result<Option<Session>> {
        let sql = format!(
            "SELECT {SESSION_COLUMNS} FROM sessions WHERE amux_workspace_name=? AND amux_process_name=?"
        );
        let row: Option<SessionRow> = sqlx::query_as(sqlx::AssertSqlSafe(sql))
            .bind(workspace)
            .bind(process)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.map(Into::into))
    }
    pub async fn rename_session(&self, id: &str, name: &str) -> Result<()> {
        let timestamp = now();
        let r = sqlx::query!(
            "UPDATE sessions SET name=?,name_is_custom=1,updated_at=? WHERE id=?",
            name,
            timestamp,
            id
        )
        .execute(&self.pool)
        .await?;
        if r.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }
    pub async fn reorder_sessions(&self, workspace_id: &str, session_ids: &[String]) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        for (sort_order, id) in session_ids.iter().enumerate() {
            let r = sqlx::query(
                "UPDATE sessions SET sort_order=?,updated_at=? WHERE id=? AND workspace_id=?",
            )
            .bind(sort_order as i64)
            .bind(now())
            .bind(id)
            .bind(workspace_id)
            .execute(&mut *tx)
            .await?;
            if r.rows_affected() == 0 {
                return Err(AppError::BadRequest(
                    "every Session must belong to the target Workspace".into(),
                ));
            }
        }
        tx.commit().await?;
        Ok(())
    }
    pub async fn touch_session(&self, id: &str) -> Result<()> {
        let timestamp = now();
        sqlx::query("UPDATE sessions SET last_attached_at=?,updated_at=? WHERE id=?")
            .bind(&timestamp)
            .bind(&timestamp)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
    fn with_title(&self, mut session: Session) -> Session {
        if let Some(title) = self.titles.get(&session.id) {
            session.terminal_title = Some(title);
        }
        session
    }
    pub async fn persist_terminal_titles(&self, flush: bool) -> Result<()> {
        for (id, title) in self.titles.pending(std::time::Instant::now(), flush) {
            sqlx::query!(
                "UPDATE sessions SET terminal_title=? WHERE id=? AND terminal_title IS NOT ?",
                title,
                id,
                title
            )
            .execute(&self.pool)
            .await?;
            self.titles.saved(&id, &title);
        }
        Ok(())
    }

    pub async fn uncaptured_agent_sessions(&self) -> Result<Vec<Session>> {
        let sql = format!(
            "SELECT {SESSION_COLUMNS} FROM sessions WHERE kind=? AND agent_session_id IS NULL"
        );
        let mut sessions = Vec::new();
        for kind in crate::settings::AGENT_KINDS {
            sessions.extend(self.session_rows(&sql, kind).await?);
        }
        Ok(sessions)
    }
    pub async fn set_agent_session_id(&self, id: &str, agent_session_id: &str) -> Result<bool> {
        Ok(sqlx::query("UPDATE sessions SET agent_session_id=?,updated_at=? WHERE id=? AND agent_session_id IS NULL")
            .bind(agent_session_id)
            .bind(now())
            .bind(id)
            .execute(&self.pool)
            .await?.rows_affected() == 1)
    }
    pub async fn delete_session(&self, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM sessions WHERE id=?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
    pub async fn finalize_sessions(
        &self,
        workspace_id: &str,
        resume_cwd: &str,
        keep_history: bool,
    ) -> Result<()> {
        let timestamp = now();
        let mut tx = self.pool.begin().await?;
        if keep_history {
            sqlx::query("DELETE FROM sessions WHERE workspace_id=? AND kind='shell'")
                .bind(workspace_id)
                .execute(&mut *tx)
                .await?;
            sqlx::query("UPDATE sessions SET cwd=?,visibility='hidden',hidden_at=?,status='stopped',updated_at=? WHERE workspace_id=? AND kind IN ('codex','claude_code','opencode','pi')").bind(resume_cwd).bind(&timestamp).bind(&timestamp).bind(workspace_id).execute(&mut *tx).await?;
        } else {
            sqlx::query("DELETE FROM sessions WHERE workspace_id=?")
                .bind(workspace_id)
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        Ok(())
    }
    async fn session_additional_directories(&self, id: &str) -> Result<Vec<String>> {
        Ok(sqlx::query_scalar("SELECT path FROM session_additional_directories WHERE session_id=? AND access_mode='read_write' ORDER BY path").bind(id).fetch_all(&self.pool).await?)
    }
    pub async fn replace_session_additional_directories(
        &self,
        id: &str,
        paths: &[String],
    ) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM session_additional_directories WHERE session_id=? AND access_mode='read_write'").bind(id).execute(&mut *tx).await?;
        for path in paths {
            sqlx::query("INSERT INTO session_additional_directories(session_id,path) VALUES(?,?)")
                .bind(id)
                .bind(path)
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        Ok(())
    }
    pub async fn add_session_read_only_contexts(&self, id: &str, paths: &[String]) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        for path in paths {
            sqlx::query("INSERT OR REPLACE INTO session_additional_directories(session_id,path,access_mode) VALUES(?,?,'read_only')").bind(id).bind(path).execute(&mut *tx).await?;
        }
        tx.commit().await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn session_names_and_terminal_titles_persist_independently() {
        let root = tempfile::tempdir().unwrap();
        let store = Store::open(root.path()).await.unwrap();
        sqlx::raw_sql("INSERT INTO projects(id,name,created_at,updated_at) VALUES('p','P','t','t');
            INSERT INTO workspaces(id,project_id,name,kind,status,created_at,updated_at) VALUES('w','p','W','workspace','active','t','t');")
            .execute(&store.pool).await.unwrap();
        let cases = [
            ("default", "codex", "Codex", 0, "Codex"),
            ("owned-lowercase", "codex", "codex", 1, "codex"),
            ("owned-capitalized", "codex", "Codex", 1, "Codex"),
            ("owned-title", "codex", "Saved title", 1, "Saved title"),
            ("other-kind", "shell", "codex", 1, "codex"),
        ];
        for (id, kind, name, handled, _) in cases {
            sqlx::query("INSERT INTO sessions(id,workspace_id,name,kind,cwd,original_cwd,agent_session_id,name_is_custom,status,launch_started_at,created_at,updated_at) VALUES(?,'w',?,?,'/repo','/repo',?,?,'stopped','t','t','t')")
                .bind(id).bind(name).bind(kind).bind(id).bind(handled)
                .execute(&store.pool).await.unwrap();
        }
        let mut fresh = store.session("default").await.unwrap();
        for (id, _, _, handled, expected) in cases {
            let session = store.session(id).await.unwrap();
            assert_eq!(session.name, expected, "{id}");
            assert_eq!(session.agent_session_id.as_deref(), Some(id));
            assert_eq!(session.name_is_custom, handled != 0);
        }
        fresh.id = "fresh".into();
        fresh.name = "Codex".into();
        fresh.agent_session_id = None;
        store.create_session(&fresh).await.unwrap();
        store
            .titles
            .update("fresh", "Terminal task".into(), std::time::Instant::now());
        store.persist_terminal_titles(true).await.unwrap();
        let reopened = Store::open(root.path()).await.unwrap();
        let saved = reopened.session("fresh").await.unwrap();
        assert_eq!(saved.terminal_title.as_deref(), Some("Terminal task"));
        assert_eq!(saved.name, "Codex");
        assert!(!saved.name_is_custom);
        store.rename_session("fresh", "Codex").await.unwrap();
        assert!(store.session("fresh").await.unwrap().name_is_custom);
        reopened.pool.close().await;
        store.pool.close().await;
    }

    #[tokio::test]
    async fn history_finalization_preserves_metadata_for_all_agents() {
        let root = tempfile::tempdir().unwrap();
        let store = Store::open(root.path()).await.unwrap();
        sqlx::raw_sql("INSERT INTO projects(id,name,created_at,updated_at) VALUES('p','P','t','t');
            INSERT INTO workspaces(id,project_id,name,kind,status,created_at,updated_at) VALUES('w','p','W','workspace','active','t','t');
            INSERT INTO sessions(id,workspace_id,name,kind,cwd,original_cwd,agent_session_id,name_is_custom,status,launch_started_at,created_at,updated_at) VALUES('codex','w','My saved title','codex','/old','/old','saved-codex',1,'stopped','t','t','t');")
            .execute(&store.pool).await.unwrap();
        let original = store.session("codex").await.unwrap();
        assert_eq!(original.agent_session_id.as_deref(), Some("saved-codex"));
        assert_eq!(original.name, "My saved title");
        assert!(original.name_is_custom);
        for kind in ["claude_code", "opencode", "pi"] {
            let mut session = original.clone();
            session.id = kind.into();
            session.kind = kind.into();
            session.name = crate::agents::name(kind).unwrap().into();
            session.status = "running".into();
            session.agent_session_id = Some(format!("native-{kind}"));
            store.create_session(&session).await.unwrap();
            store
                .titles
                .update(kind, "Automatic title".into(), std::time::Instant::now());
            store.persist_terminal_titles(true).await.unwrap();
            assert_eq!(
                store.session(kind).await.unwrap().terminal_title.as_deref(),
                Some("Automatic title")
            );
            store
                .rename_session(kind, crate::agents::name(kind).unwrap())
                .await
                .unwrap();
            assert!(store.session(kind).await.unwrap().name_is_custom);
        }
        store.finalize_sessions("w", "/target", true).await.unwrap();
        let sessions = store.sessions("w").await.unwrap();
        assert_eq!(sessions.len(), 4);
        for session in sessions {
            assert_eq!(session.cwd, "/target");
            assert_eq!(session.original_cwd, "/old");
            assert_eq!(session.visibility, "hidden");
            assert_eq!(session.status, "stopped");
            assert!(session.agent_session_id.is_some());
        }
        store
            .finalize_sessions("w", "/target", false)
            .await
            .unwrap();
        assert!(store.sessions("w").await.unwrap().is_empty());
        store.pool.close().await;
    }
}
