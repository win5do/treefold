#![allow(dead_code)]

use super::{Store, now};
use crate::{
    error::{AppError, Result},
    model::Session,
};

const SESSION_COLUMNS: &str = "id,workspace_id,name,kind,cwd,original_cwd,initial_prompt,agent_session_id,visibility,hidden_at,evicted_at,amux_workspace_name,amux_process_name,status,exit_code,exit_signal,argv,io_mode,launch_started_at,last_attached_at,created_at,updated_at";

#[derive(sqlx::FromRow)]
struct SessionRow {
    id: String,
    workspace_id: String,
    name: String,
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
            .map(Into::into)
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
        Ok(value)
    }
    pub async fn create_session(&self, s: &Session) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        let title_handled = crate::agents::default_session_name(&s.kind) != Some(s.name.as_str());
        sqlx::query("INSERT INTO sessions(id,workspace_id,name,kind,cwd,original_cwd,initial_prompt,agent_session_id,visibility,hidden_at,evicted_at,amux_workspace_name,amux_process_name,status,exit_code,exit_signal,argv,io_mode,launch_started_at,last_attached_at,created_at,updated_at,agent_title_imported) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
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
            "UPDATE sessions SET name=?,agent_title_imported=1,updated_at=? WHERE id=?",
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
    pub async fn pending_agent_titles(&self) -> Result<Vec<(String, String)>> {
        Ok(sqlx::query!("SELECT id, agent_session_id AS 'agent_session_id!' FROM sessions WHERE agent_session_id IS NOT NULL AND agent_title_imported=0")
            .fetch_all(&self.pool).await?.into_iter().map(|row| (row.id, row.agent_session_id)).collect())
    }

    pub async fn import_agent_title(&self, id: &str, native_id: &str, title: &str) -> Result<bool> {
        let title = title.trim();
        if title.is_empty() {
            return Ok(false);
        }
        let timestamp = now();
        Ok(sqlx::query!("UPDATE sessions SET name=?,agent_title_imported=1,updated_at=? WHERE id=? AND agent_session_id=? AND agent_title_imported=0", title, timestamp, id, native_id)
            .execute(&self.pool).await?.rows_affected() == 1)
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
    use sqlx::{Connection, Executor};

    #[tokio::test]
    async fn codex_default_name_upgrade_preserves_owned_titles() {
        let root = tempfile::tempdir().unwrap();
        let old = tempfile::tempdir().unwrap();
        let migrations = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("migrations/g1");
        for entry in std::fs::read_dir(migrations).unwrap().flatten() {
            if entry.file_name().to_string_lossy().as_ref() < "20261003154835" {
                std::fs::copy(entry.path(), old.path().join(entry.file_name())).unwrap();
            }
        }
        let mut connection = sqlx::SqliteConnection::connect_with(
            &sqlx::sqlite::SqliteConnectOptions::new()
                .filename(root.path().join(crate::store::CURRENT_DATABASE_FILENAME))
                .create_if_missing(true),
        )
        .await
        .unwrap();
        sqlx::migrate::Migrator::new(old.path())
            .await
            .unwrap()
            .run(&mut connection)
            .await
            .unwrap();
        connection.execute("INSERT INTO projects(id,name,created_at,updated_at) VALUES('p','P','t','t');
            INSERT INTO workspaces(id,project_id,name,kind,status,created_at,updated_at) VALUES('w','p','W','workspace','active','t','t');").await.unwrap();
        let cases = [
            ("default", "codex", "codex", 0, "Codex"),
            ("owned-lowercase", "codex", "codex", 1, "codex"),
            ("owned-capitalized", "codex", "Codex", 1, "Codex"),
            ("owned-title", "codex", "Saved title", 1, "Saved title"),
            ("other-kind", "shell", "codex", 1, "codex"),
        ];
        for (id, kind, name, handled, _) in cases {
            sqlx::query("INSERT INTO sessions(id,workspace_id,name,kind,cwd,original_cwd,agent_session_id,agent_title_imported,status,launch_started_at,created_at,updated_at) VALUES(?,'w',?,?,'/repo','/repo',?,?,'stopped','t','t','t')")
                .bind(id).bind(name).bind(kind).bind(id).bind(handled)
                .execute(&mut connection).await.unwrap();
        }
        connection.close().await.unwrap();

        let store = Store::open(root.path()).await.unwrap();
        let mut fresh = store.session("default").await.unwrap();
        for (id, _, _, handled, expected) in cases {
            let session = store.session(id).await.unwrap();
            assert_eq!(session.name, expected, "{id}");
            assert_eq!(session.agent_session_id.as_deref(), Some(id));
            assert_eq!(
                store
                    .import_agent_title(id, id, "Automatic title")
                    .await
                    .unwrap(),
                handled == 0,
                "{id}"
            );
        }

        fresh.id = "fresh".into();
        fresh.name = crate::agents::default_session_name("codex").unwrap().into();
        fresh.agent_session_id = Some("fresh-native".into());
        store.create_session(&fresh).await.unwrap();
        assert_eq!(store.session("fresh").await.unwrap().name, "Codex");
        assert!(
            store
                .import_agent_title("fresh", "fresh-native", "New title")
                .await
                .unwrap()
        );
        store.rename_session("fresh", "Codex").await.unwrap();
        assert!(
            !store
                .import_agent_title("fresh", "fresh-native", "Overwrite rename")
                .await
                .unwrap()
        );
        assert_eq!(store.session("fresh").await.unwrap().name, "Codex");
        store.pool.close().await;
    }

    #[tokio::test]
    async fn agent_metadata_upgrade_preserves_codex_and_history_finalization_covers_all_agents() {
        let root = tempfile::tempdir().unwrap();
        let old = tempfile::tempdir().unwrap();
        let migrations = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("migrations/g1");
        for entry in std::fs::read_dir(&migrations).unwrap().flatten() {
            if entry.file_name().to_string_lossy().as_ref() < "20261003010000" {
                std::fs::copy(entry.path(), old.path().join(entry.file_name())).unwrap();
            }
        }
        let mut connection = sqlx::SqliteConnection::connect_with(
            &sqlx::sqlite::SqliteConnectOptions::new()
                .filename(root.path().join(crate::store::CURRENT_DATABASE_FILENAME))
                .create_if_missing(true),
        )
        .await
        .unwrap();
        sqlx::migrate::Migrator::new(old.path())
            .await
            .unwrap()
            .run(&mut connection)
            .await
            .unwrap();
        connection.execute("INSERT INTO projects(id,name,created_at,updated_at) VALUES('p','P','t','t');
            INSERT INTO workspaces(id,project_id,name,kind,status,created_at,updated_at) VALUES('w','p','W','workspace','active','t','t');
            INSERT INTO sessions(id,workspace_id,name,kind,cwd,original_cwd,codex_session_id,codex_title_imported,status,launch_started_at,created_at,updated_at) VALUES('codex','w','My saved title','codex','/old','/old','saved-codex',1,'stopped','t','t','t');").await.unwrap();
        connection.close().await.unwrap();
        let store = Store::open(root.path()).await.unwrap();
        let original = store.session("codex").await.unwrap();
        assert_eq!(original.agent_session_id.as_deref(), Some("saved-codex"));
        assert_eq!(original.name, "My saved title");
        assert!(
            !store
                .import_agent_title("codex", "saved-codex", "Overwrite")
                .await
                .unwrap()
        );
        for kind in ["claude_code", "opencode", "pi"] {
            let mut session = original.clone();
            session.id = kind.into();
            session.kind = kind.into();
            session.name = crate::agents::name(kind).unwrap().into();
            session.status = "running".into();
            session.agent_session_id = Some(format!("native-{kind}"));
            store.create_session(&session).await.unwrap();
            assert!(
                store
                    .import_agent_title(kind, &format!("native-{kind}"), "Automatic title")
                    .await
                    .unwrap()
            );
            assert!(
                !store
                    .import_agent_title(kind, &format!("native-{kind}"), "Later title")
                    .await
                    .unwrap()
            );
            store
                .rename_session(kind, crate::agents::name(kind).unwrap())
                .await
                .unwrap();
            assert!(
                !store
                    .import_agent_title(kind, &format!("native-{kind}"), "Overwrite rename")
                    .await
                    .unwrap()
            );
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
