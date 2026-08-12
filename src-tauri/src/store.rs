use std::{path::Path, sync::Arc};

use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::de::DeserializeOwned;

use crate::{error::Result, model::*};

#[derive(Clone)]
pub struct Store(Arc<Mutex<Connection>>);

const SCHEMA: &str = r#"
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS projects (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'active',
 primary_directory_id TEXT NOT NULL, base_branch TEXT NOT NULL DEFAULT 'main',
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_directories (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 worktree_setup_command TEXT NOT NULL DEFAULT '', path TEXT NOT NULL,
 role TEXT NOT NULL, is_git INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
 UNIQUE(project_id,path)
);
CREATE TABLE IF NOT EXISTS workstreams (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
 kind TEXT NOT NULL DEFAULT 'workstream',
 parent_workstream_id TEXT REFERENCES workstreams(id) ON DELETE RESTRICT,
 workspace_mode TEXT NOT NULL, project_directory_id TEXT NOT NULL REFERENCES project_directories(id),
 worktree_id TEXT, workspace_path TEXT NOT NULL, base_ref TEXT NOT NULL DEFAULT '',
 base_commit TEXT NOT NULL DEFAULT '', branch TEXT NOT NULL DEFAULT '',
 forked_from_commit TEXT, integration_status TEXT NOT NULL DEFAULT 'none',
 close_outcome TEXT, integrated_commit TEXT, closed_at TEXT,
 runtime_id TEXT NOT NULL DEFAULT '', runtime_name TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 id TEXT PRIMARY KEY, workstream_id TEXT NOT NULL REFERENCES workstreams(id) ON DELETE CASCADE,
 name TEXT NOT NULL, kind TEXT NOT NULL, cwd TEXT NOT NULL, original_cwd TEXT NOT NULL,
 initial_prompt TEXT NOT NULL DEFAULT '',
 codex_session_id TEXT, yolo INTEGER NOT NULL DEFAULT 0, sidebar_visible INTEGER NOT NULL DEFAULT 1,
 hidden_at TEXT, evicted_at TEXT, process_id TEXT NOT NULL DEFAULT '',
 process_name TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, pid INTEGER NOT NULL DEFAULT 0,
 process_group_id INTEGER NOT NULL DEFAULT 0, exit_code INTEGER, exit_signal TEXT NOT NULL DEFAULT '',
 command TEXT NOT NULL DEFAULT '[]', launch_started_at TEXT NOT NULL, last_attached_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS session_additional_directories (
 session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, path TEXT NOT NULL,
 PRIMARY KEY(session_id,path)
);
CREATE TABLE IF NOT EXISTS todos (
 id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
 workstream_id TEXT REFERENCES workstreams(id) ON DELETE CASCADE,
 origin_workstream_id TEXT REFERENCES workstreams(id) ON DELETE SET NULL,
 title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
 session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 CHECK ((project_id IS NULL) != (workstream_id IS NULL))
);
CREATE TABLE IF NOT EXISTS settlement_operations (
 workstream_id TEXT PRIMARY KEY REFERENCES workstreams(id) ON DELETE CASCADE,
 phase TEXT NOT NULL, code_action TEXT NOT NULL, todo_action TEXT NOT NULL,
 keep_session_history INTEGER NOT NULL,
 delete_worktree INTEGER NOT NULL, delete_branch INTEGER NOT NULL,
 commit_message TEXT NOT NULL DEFAULT '', before_head TEXT NOT NULL DEFAULT '',
 source_head TEXT NOT NULL DEFAULT '', target_head TEXT NOT NULL DEFAULT '',
 integrated_commit TEXT, error TEXT NOT NULL DEFAULT '',
 started_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rebase_operations (
 id TEXT PRIMARY KEY, workstream_id TEXT NOT NULL REFERENCES workstreams(id) ON DELETE CASCADE,
 status TEXT NOT NULL, phase TEXT NOT NULL, before_head TEXT NOT NULL,
 parent_head TEXT NOT NULL, rebased_head TEXT, recovery_ref TEXT NOT NULL,
 error TEXT NOT NULL DEFAULT '', started_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 completed_at TEXT
);
CREATE INDEX IF NOT EXISTS rebase_operations_workstream_updated
 ON rebase_operations(workstream_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS settlement_preflights (
 id TEXT PRIMARY KEY, workstream_id TEXT NOT NULL REFERENCES workstreams(id) ON DELETE CASCADE,
 code_action TEXT NOT NULL, source_head TEXT NOT NULL, target_head TEXT NOT NULL,
 target_branch TEXT NOT NULL, source_status TEXT NOT NULL, source_dirty INTEGER NOT NULL,
 target_dirty INTEGER NOT NULL, ahead INTEGER NOT NULL, behind INTEGER NOT NULL,
 changed_files TEXT NOT NULL, commits TEXT NOT NULL, diff_stat TEXT NOT NULL,
 blockers TEXT NOT NULL, warnings TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS settlement_preflights_workstream_created
 ON settlement_preflights(workstream_id,created_at DESC);
CREATE TABLE IF NOT EXISTS reset_operations (
 id TEXT PRIMARY KEY, workstream_id TEXT NOT NULL REFERENCES workstreams(id) ON DELETE CASCADE,
 status TEXT NOT NULL, mode TEXT NOT NULL, before_head TEXT NOT NULL,
 target_head TEXT NOT NULL, result_head TEXT, recovery_ref TEXT NOT NULL,
 error TEXT NOT NULL DEFAULT '', started_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 completed_at TEXT
);
CREATE INDEX IF NOT EXISTS reset_operations_workstream_started
 ON reset_operations(workstream_id,started_at DESC);
DROP TABLE IF EXISTS settings;
"#;

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(anyhow::Error::from)?;
        }
        let connection = Connection::open(path)?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        migrate_development_schema(&connection)?;
        connection.execute_batch("PRAGMA journal_mode=WAL;")?;
        connection.execute_batch(SCHEMA)?;
        Ok(Self(Arc::new(Mutex::new(connection))))
    }

    pub fn projects(&self) -> Result<Vec<Project>> {
        let db = self.0.lock();
        let mut stmt = db.prepare("SELECT id,name,description,status,primary_directory_id,base_branch,created_at,updated_at FROM projects ORDER BY updated_at DESC")?;
        let values = stmt
            .query_map([], project_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(values)
    }

    pub fn project(&self, id: &str) -> Result<Project> {
        let db = self.0.lock();
        Ok(db.query_row("SELECT id,name,description,status,primary_directory_id,base_branch,created_at,updated_at FROM projects WHERE id=?", [id], project_row)?)
    }

    pub fn create_project(&self, p: &Project, d: &Directory) -> Result<()> {
        let mut db = self.0.lock();
        let tx = db.transaction()?;
        tx.execute(
            "INSERT INTO projects(id,name,description,status,primary_directory_id,base_branch,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
            params![
                p.id,
                p.name,
                p.description,
                p.status,
                p.primary_directory_id,
                p.base_branch,
                p.created_at,
                p.updated_at
            ],
        )?;
        tx.execute("INSERT INTO project_directories(id,project_id,name,description,worktree_setup_command,path,role,is_git,created_at) VALUES(?,?,?,?,?,?,?,?,?)", params![d.id,d.project_id,d.name,d.description,d.worktree_setup_command,d.path,d.role,d.is_git,d.created_at])?;
        tx.commit()?;
        Ok(())
    }

    pub fn update_project_status(&self, id: &str, status: &str) -> Result<()> {
        let changed = self.0.lock().execute(
            "UPDATE projects SET status=?,updated_at=? WHERE id=?",
            params![status, now(), id],
        )?;
        if changed == 0 {
            return Err(crate::error::AppError::NotFound);
        }
        Ok(())
    }

    pub fn delete_project(&self, id: &str) -> Result<()> {
        let changed = self
            .0
            .lock()
            .execute("DELETE FROM projects WHERE id=?", [id])?;
        if changed == 0 {
            return Err(crate::error::AppError::NotFound);
        }
        Ok(())
    }

    pub fn directories(&self, project_id: &str) -> Result<Vec<Directory>> {
        let db = self.0.lock();
        let mut stmt = db.prepare("SELECT id,project_id,name,description,worktree_setup_command,path,role,is_git,created_at FROM project_directories WHERE project_id=? ORDER BY CASE role WHEN 'primary' THEN 0 ELSE 1 END,name")?;
        let values = stmt
            .query_map([project_id], directory_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(values)
    }

    pub fn directory(&self, id: &str) -> Result<Directory> {
        let db = self.0.lock();
        Ok(db.query_row("SELECT id,project_id,name,description,worktree_setup_command,path,role,is_git,created_at FROM project_directories WHERE id=?", [id], directory_row)?)
    }

    pub fn create_directory(&self, d: &Directory) -> Result<()> {
        self.0.lock().execute("INSERT INTO project_directories(id,project_id,name,description,worktree_setup_command,path,role,is_git,created_at) VALUES(?,?,?,?,?,?,?,?,?)", params![d.id,d.project_id,d.name,d.description,d.worktree_setup_command,d.path,d.role,d.is_git,d.created_at])?;
        Ok(())
    }

    pub fn update_directory(
        &self,
        id: &str,
        name: &str,
        description: &str,
        worktree_setup_command: &str,
    ) -> Result<()> {
        self.0.lock().execute(
            "UPDATE project_directories SET name=?,description=?,worktree_setup_command=? WHERE id=?",
            params![name, description, worktree_setup_command, id],
        )?;
        Ok(())
    }

    pub fn workstreams(&self, project_id: &str) -> Result<Vec<Workstream>> {
        let db = self.0.lock();
        let mut stmt = db.prepare(&format!("SELECT {WORKSTREAM_COLUMNS} FROM workstreams WHERE project_id=? ORDER BY updated_at DESC"))?;
        let values = stmt
            .query_map([project_id], workstream_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(values)
    }

    pub fn base_workstream(&self, project_id: &str) -> Result<Option<Workstream>> {
        let db = self.0.lock();
        Ok(db
            .query_row(
                &format!("SELECT {WORKSTREAM_COLUMNS} FROM workstreams WHERE project_id=? AND kind='base' LIMIT 1"),
                [project_id],
                workstream_row,
            )
            .optional()?)
    }

    pub fn workstream(&self, id: &str) -> Result<Workstream> {
        let db = self.0.lock();
        Ok(db.query_row(
            &format!("SELECT {WORKSTREAM_COLUMNS} FROM workstreams WHERE id=?"),
            [id],
            workstream_row,
        )?)
    }

    pub fn create_workstream(&self, w: &Workstream) -> Result<()> {
        self.0.lock().execute("INSERT INTO workstreams(id,project_id,name,description,status,kind,parent_workstream_id,workspace_mode,project_directory_id,worktree_id,workspace_path,base_ref,base_commit,branch,forked_from_commit,integration_status,close_outcome,integrated_commit,closed_at,runtime_id,runtime_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", params![w.id,w.project_id,w.name,w.description,w.status,w.kind,w.parent_workstream_id,w.workspace_mode,w.project_directory_id,w.worktree_id,w.workspace_path,w.base_ref,w.base_commit,w.branch,w.forked_from_commit,w.integration_status,w.close_outcome,w.integrated_commit,w.closed_at,w.runtime_id,w.runtime_name,w.created_at,w.updated_at])?;
        Ok(())
    }

    pub fn forks(&self, workstream_id: &str) -> Result<Vec<Workstream>> {
        let db = self.0.lock();
        let mut stmt = db.prepare(&format!("SELECT {WORKSTREAM_COLUMNS} FROM workstreams WHERE parent_workstream_id=? ORDER BY updated_at DESC"))?;
        let values = stmt
            .query_map([workstream_id], workstream_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(values)
    }

    pub fn settle_workstream(
        &self,
        id: &str,
        integration_status: &str,
        close_outcome: &str,
        integrated_commit: Option<&str>,
        timestamp: &str,
    ) -> Result<()> {
        self.0.lock().execute(
            "UPDATE workstreams SET status='archived',integration_status=?,close_outcome=?,integrated_commit=?,closed_at=?,updated_at=? WHERE id=?",
            params![integration_status, close_outcome, integrated_commit, timestamp, timestamp, id],
        )?;
        Ok(())
    }

    pub fn set_integration_status(&self, id: &str, status: &str) -> Result<()> {
        self.0.lock().execute(
            "UPDATE workstreams SET integration_status=?,updated_at=? WHERE id=?",
            params![status, now(), id],
        )?;
        Ok(())
    }

    pub fn settlement_operation(&self, workstream_id: &str) -> Result<Option<SettlementOperation>> {
        let db = self.0.lock();
        Ok(db
            .query_row(
                &format!(
                    "SELECT {SETTLEMENT_OPERATION_COLUMNS} FROM settlement_operations WHERE workstream_id=?"
                ),
                [workstream_id],
                settlement_operation_row,
            )
            .optional()?)
    }

    pub fn create_settlement_operation(&self, operation: &SettlementOperation) -> Result<()> {
        self.0.lock().execute(
            "INSERT INTO settlement_operations(workstream_id,phase,code_action,todo_action,keep_session_history,delete_worktree,delete_branch,commit_message,before_head,source_head,target_head,integrated_commit,error,started_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            params![
                operation.workstream_id,
                operation.phase,
                operation.code_action,
                operation.todo_action,
                operation.keep_session_history,
                operation.delete_worktree,
                operation.delete_branch,
                operation.commit_message,
                operation.before_head,
                operation.source_head,
                operation.target_head,
                operation.integrated_commit,
                operation.error,
                operation.started_at,
                operation.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn advance_settlement(
        &self,
        workstream_id: &str,
        phase: &str,
        source_head: Option<&str>,
        target_head: Option<&str>,
        integrated_commit: Option<&str>,
    ) -> Result<()> {
        self.0.lock().execute(
            "UPDATE settlement_operations SET phase=?,source_head=COALESCE(?,source_head),target_head=COALESCE(?,target_head),integrated_commit=COALESCE(?,integrated_commit),error='',updated_at=? WHERE workstream_id=?",
            params![phase, source_head, target_head, integrated_commit, now(), workstream_id],
        )?;
        Ok(())
    }

    pub fn set_settlement_error(&self, workstream_id: &str, error: &str) -> Result<()> {
        self.0.lock().execute(
            "UPDATE settlement_operations SET error=?,updated_at=? WHERE workstream_id=?",
            params![error, now(), workstream_id],
        )?;
        Ok(())
    }

    pub fn latest_rebase_operation(&self, workstream_id: &str) -> Result<Option<RebaseOperation>> {
        let db = self.0.lock();
        Ok(db
            .query_row(
                &format!(
                    "SELECT {REBASE_OPERATION_COLUMNS} FROM rebase_operations WHERE workstream_id=? ORDER BY updated_at DESC,rowid DESC LIMIT 1"
                ),
                [workstream_id],
                rebase_operation_row,
            )
            .optional()?)
    }

    pub fn rebase_operations(&self, workstream_id: &str) -> Result<Vec<RebaseOperation>> {
        let db = self.0.lock();
        let mut stmt = db.prepare(&format!(
            "SELECT {REBASE_OPERATION_COLUMNS} FROM rebase_operations WHERE workstream_id=? ORDER BY started_at DESC,rowid DESC"
        ))?;
        let values = stmt
            .query_map([workstream_id], rebase_operation_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(values)
    }

    pub fn create_rebase_operation(&self, operation: &RebaseOperation) -> Result<()> {
        self.0.lock().execute(
            "INSERT INTO rebase_operations(id,workstream_id,status,phase,before_head,parent_head,rebased_head,recovery_ref,error,started_at,updated_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            params![
                operation.id,
                operation.workstream_id,
                operation.status,
                operation.phase,
                operation.before_head,
                operation.parent_head,
                operation.rebased_head,
                operation.recovery_ref,
                operation.error,
                operation.started_at,
                operation.updated_at,
                operation.completed_at,
            ],
        )?;
        Ok(())
    }

    pub fn update_rebase_operation(
        &self,
        id: &str,
        status: &str,
        phase: &str,
        rebased_head: Option<&str>,
        error: &str,
        completed: bool,
    ) -> Result<()> {
        let timestamp = now();
        self.0.lock().execute(
            "UPDATE rebase_operations SET status=?,phase=?,rebased_head=COALESCE(?,rebased_head),error=?,updated_at=?,completed_at=CASE WHEN ? THEN COALESCE(completed_at,?) ELSE completed_at END WHERE id=?",
            params![
                status,
                phase,
                rebased_head,
                error,
                timestamp,
                completed,
                timestamp,
                id,
            ],
        )?;
        Ok(())
    }

    pub fn create_settlement_preflight(&self, preflight: &SettlementPreflight) -> Result<()> {
        self.0.lock().execute(
            "INSERT INTO settlement_preflights(id,workstream_id,code_action,source_head,target_head,target_branch,source_status,source_dirty,target_dirty,ahead,behind,changed_files,commits,diff_stat,blockers,warnings,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            params![
                preflight.id,
                preflight.workstream_id,
                preflight.code_action,
                preflight.source_head,
                preflight.target_head,
                preflight.target_branch,
                preflight.source_status,
                preflight.source_dirty,
                preflight.target_dirty,
                preflight.ahead,
                preflight.behind,
                serde_json::to_string(&preflight.changed_files).map_err(anyhow::Error::from)?,
                serde_json::to_string(&preflight.commits).map_err(anyhow::Error::from)?,
                preflight.diff_stat,
                serde_json::to_string(&preflight.blockers).map_err(anyhow::Error::from)?,
                serde_json::to_string(&preflight.warnings).map_err(anyhow::Error::from)?,
                preflight.created_at,
            ],
        )?;
        Ok(())
    }

    pub fn settlement_preflight(&self, id: &str) -> Result<SettlementPreflight> {
        let db = self.0.lock();
        Ok(db.query_row(
            "SELECT id,workstream_id,code_action,source_head,target_head,target_branch,source_status,source_dirty,target_dirty,ahead,behind,changed_files,commits,diff_stat,blockers,warnings,created_at FROM settlement_preflights WHERE id=?",
            [id],
            settlement_preflight_row,
        )?)
    }

    pub fn reset_operation(&self, id: &str) -> Result<ResetOperation> {
        let db = self.0.lock();
        Ok(db.query_row(
            &format!("SELECT {RESET_OPERATION_COLUMNS} FROM reset_operations WHERE id=?"),
            [id],
            reset_operation_row,
        )?)
    }

    pub fn latest_reset_operation(&self, workstream_id: &str) -> Result<Option<ResetOperation>> {
        let db = self.0.lock();
        Ok(db
            .query_row(
                &format!("SELECT {RESET_OPERATION_COLUMNS} FROM reset_operations WHERE workstream_id=? ORDER BY started_at DESC,rowid DESC LIMIT 1"),
                [workstream_id],
                reset_operation_row,
            )
            .optional()?)
    }

    pub fn reset_operations(&self, workstream_id: &str) -> Result<Vec<ResetOperation>> {
        let db = self.0.lock();
        let mut stmt = db.prepare(&format!(
            "SELECT {RESET_OPERATION_COLUMNS} FROM reset_operations WHERE workstream_id=? ORDER BY started_at DESC,rowid DESC"
        ))?;
        let values = stmt
            .query_map([workstream_id], reset_operation_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(values)
    }

    pub fn create_reset_operation(&self, operation: &ResetOperation) -> Result<()> {
        self.0.lock().execute(
            "INSERT INTO reset_operations(id,workstream_id,status,mode,before_head,target_head,result_head,recovery_ref,error,started_at,updated_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            params![
                operation.id,
                operation.workstream_id,
                operation.status,
                operation.mode,
                operation.before_head,
                operation.target_head,
                operation.result_head,
                operation.recovery_ref,
                operation.error,
                operation.started_at,
                operation.updated_at,
                operation.completed_at,
            ],
        )?;
        Ok(())
    }

    pub fn update_reset_operation(
        &self,
        id: &str,
        status: &str,
        result_head: Option<&str>,
        error: &str,
        completed: bool,
    ) -> Result<()> {
        let timestamp = now();
        self.0.lock().execute(
            "UPDATE reset_operations SET status=?,result_head=COALESCE(?,result_head),error=?,updated_at=?,completed_at=CASE WHEN ? THEN COALESCE(completed_at,?) ELSE completed_at END WHERE id=?",
            params![status, result_head, error, timestamp, completed, timestamp, id],
        )?;
        Ok(())
    }

    pub fn sessions(&self, workstream_id: &str) -> Result<Vec<Session>> {
        let db = self.0.lock();
        let mut stmt = db.prepare(&format!(
            "SELECT {SESSION_COLUMNS} FROM sessions WHERE workstream_id=? ORDER BY created_at DESC"
        ))?;
        let mut values = stmt
            .query_map([workstream_id], session_row)?
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
        tx.execute("INSERT INTO sessions(id,workstream_id,name,kind,cwd,original_cwd,initial_prompt,codex_session_id,yolo,sidebar_visible,hidden_at,evicted_at,process_id,process_name,status,pid,process_group_id,exit_code,exit_signal,command,launch_started_at,last_attached_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", params![s.id,s.workstream_id,s.name,s.kind,s.cwd,s.original_cwd,s.initial_prompt,s.codex_session_id,s.yolo,s.sidebar_visible,s.hidden_at,s.evicted_at,s.process_id,s.process_name,s.status,s.pid,s.process_group_id,s.exit_code,s.exit_signal,serde_json::to_string(&s.command).unwrap_or_default(),s.launch_started_at,s.last_attached_at,s.created_at,s.updated_at])?;
        for path in &s.additional_directories {
            tx.execute(
                "INSERT INTO session_additional_directories(session_id,path) VALUES(?,?)",
                params![s.id, path],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

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

    pub fn settle_sessions(
        &self,
        workstream_id: &str,
        resume_cwd: &str,
        keep_history: bool,
    ) -> Result<()> {
        let timestamp = now();
        let db = self.0.lock();
        if keep_history {
            db.execute("UPDATE sessions SET cwd=?,sidebar_visible=0,hidden_at=?,status='closed',pid=0,updated_at=? WHERE workstream_id=?", params![resume_cwd,timestamp,timestamp,workstream_id])?;
        } else {
            db.execute(
                "DELETE FROM sessions WHERE workstream_id=?",
                [workstream_id],
            )?;
        }
        Ok(())
    }

    fn session_additional_directories(&self, id: &str) -> Result<Vec<String>> {
        let db = self.0.lock();
        let mut stmt = db.prepare(
            "SELECT path FROM session_additional_directories WHERE session_id=? ORDER BY path",
        )?;
        let values = stmt
            .query_map([id], |r| r.get(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(values)
    }

    pub fn replace_session_additional_directories(&self, id: &str, paths: &[String]) -> Result<()> {
        let mut db = self.0.lock();
        let tx = db.transaction()?;
        tx.execute(
            "DELETE FROM session_additional_directories WHERE session_id=?",
            [id],
        )?;
        for path in paths {
            tx.execute(
                "INSERT INTO session_additional_directories(session_id,path) VALUES(?,?)",
                params![id, path],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn todos(&self, workstream_id: &str) -> Result<Vec<Todo>> {
        let db = self.0.lock();
        let mut stmt = db.prepare(&format!(
            "SELECT {TODO_COLUMNS} FROM todos WHERE workstream_id=? OR origin_workstream_id=? ORDER BY created_at DESC"
        ))?;
        let values = stmt
            .query_map([workstream_id, workstream_id], todo_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(values)
    }

    pub fn create_todo(&self, t: &Todo) -> Result<()> {
        self.0.lock().execute(
            "INSERT INTO todos(id,project_id,workstream_id,origin_workstream_id,title,description,status,session_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
            params![
                t.id,
                t.project_id,
                t.workstream_id,
                t.origin_workstream_id,
                t.title,
                t.description,
                t.status,
                t.session_id,
                t.created_at,
                t.updated_at
            ],
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
            "UPDATE todos SET status=?,session_id=?,updated_at=? WHERE id=?",
            params![status, session_id, now(), id],
        )?;
        Ok(())
    }

    pub fn project_todos(&self, project_id: &str) -> Result<Vec<Todo>> {
        let db = self.0.lock();
        let mut stmt = db.prepare(&format!(
            "SELECT {TODO_COLUMNS} FROM todos WHERE project_id=? ORDER BY updated_at DESC"
        ))?;
        let values = stmt
            .query_map([project_id], todo_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(values)
    }

    pub fn carry_todos(
        &self,
        from_workstream_id: &str,
        project_id: Option<&str>,
        workstream_id: Option<&str>,
    ) -> Result<()> {
        self.0.lock().execute(
            "UPDATE todos SET project_id=?,workstream_id=?,origin_workstream_id=COALESCE(origin_workstream_id,?),session_id=NULL,status=CASE WHEN status IN ('assigned','in_progress') THEN 'pending' ELSE status END,updated_at=? WHERE workstream_id=?",
            params![project_id, workstream_id, from_workstream_id, now(), from_workstream_id],
        )?;
        Ok(())
    }

    pub fn delete_todos(&self, workstream_id: &str) -> Result<()> {
        self.0
            .lock()
            .execute("DELETE FROM todos WHERE workstream_id=?", [workstream_id])?;
        Ok(())
    }

    pub fn project_detail(&self, id: &str) -> Result<ProjectDetail> {
        let base = self.base_workstream(id)?;
        Ok(ProjectDetail {
            project: self.project(id)?,
            directories: self.directories(id)?,
            workstreams: self
                .workstreams(id)?
                .into_iter()
                .filter(|item| item.kind != "base")
                .collect(),
            worktrees: Vec::new(),
            todos: self.project_todos(id)?,
            sessions: match base {
                Some(value) => self.sessions(&value.id)?,
                None => Vec::new(),
            },
        })
    }

    pub fn workstream_detail(&self, id: &str) -> Result<WorkstreamDetail> {
        let workstream = self.workstream(id)?;
        Ok(WorkstreamDetail {
            project: self.project(&workstream.project_id)?,
            directories: self.directories(&workstream.project_id)?,
            sessions: self.sessions(id)?,
            todos: self.todos(id)?,
            forks: self.forks(id)?,
            workstream,
        })
    }
}

pub fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn project_row(r: &Row<'_>) -> rusqlite::Result<Project> {
    Ok(Project {
        id: r.get(0)?,
        name: r.get(1)?,
        description: r.get(2)?,
        status: r.get(3)?,
        primary_directory_id: r.get(4)?,
        base_branch: r.get(5)?,
        created_at: r.get(6)?,
        updated_at: r.get(7)?,
    })
}
fn directory_row(r: &Row<'_>) -> rusqlite::Result<Directory> {
    Ok(Directory {
        id: r.get(0)?,
        project_id: r.get(1)?,
        name: r.get(2)?,
        description: r.get(3)?,
        worktree_setup_command: r.get(4)?,
        path: r.get(5)?,
        workspace_path: None,
        role: r.get(6)?,
        is_git: r.get(7)?,
        remote_url: None,
        branch: None,
        head_commit: None,
        head_summary: None,
        dirty: false,
        created_at: r.get(8)?,
    })
}
const WORKSTREAM_COLUMNS: &str = "id,project_id,name,description,status,kind,parent_workstream_id,workspace_mode,project_directory_id,worktree_id,workspace_path,base_ref,base_commit,branch,forked_from_commit,integration_status,close_outcome,integrated_commit,closed_at,runtime_id,runtime_name,created_at,updated_at";
fn workstream_row(r: &Row<'_>) -> rusqlite::Result<Workstream> {
    Ok(Workstream {
        id: r.get(0)?,
        project_id: r.get(1)?,
        name: r.get(2)?,
        description: r.get(3)?,
        status: r.get(4)?,
        kind: r.get(5)?,
        parent_workstream_id: r.get(6)?,
        workspace_mode: r.get(7)?,
        project_directory_id: r.get(8)?,
        worktree_id: r.get(9)?,
        workspace_path: r.get(10)?,
        base_ref: r.get(11)?,
        base_commit: r.get(12)?,
        branch: r.get(13)?,
        forked_from_commit: r.get(14)?,
        integration_status: r.get(15)?,
        close_outcome: r.get(16)?,
        integrated_commit: r.get(17)?,
        closed_at: r.get(18)?,
        runtime_id: r.get(19)?,
        runtime_name: r.get(20)?,
        created_at: r.get(21)?,
        updated_at: r.get(22)?,
    })
}
const SESSION_COLUMNS: &str = "id,workstream_id,name,kind,cwd,original_cwd,initial_prompt,codex_session_id,yolo,sidebar_visible,hidden_at,evicted_at,process_id,process_name,status,pid,process_group_id,exit_code,exit_signal,command,launch_started_at,last_attached_at,created_at,updated_at";
fn session_row(r: &Row<'_>) -> rusqlite::Result<Session> {
    let command: String = r.get(19)?;
    Ok(Session {
        id: r.get(0)?,
        workstream_id: r.get(1)?,
        name: r.get(2)?,
        kind: r.get(3)?,
        cwd: r.get(4)?,
        original_cwd: r.get(5)?,
        initial_prompt: r.get(6)?,
        codex_session_id: r.get(7)?,
        yolo: r.get(8)?,
        sidebar_visible: r.get(9)?,
        hidden_at: r.get(10)?,
        evicted_at: r.get(11)?,
        process_id: r.get(12)?,
        process_name: r.get(13)?,
        status: r.get(14)?,
        pid: r.get(15)?,
        process_group_id: r.get(16)?,
        exit_code: r.get(17)?,
        exit_signal: r.get(18)?,
        command: serde_json::from_str(&command).unwrap_or_default(),
        launch_started_at: r.get(20)?,
        last_attached_at: r.get(21)?,
        created_at: r.get(22)?,
        updated_at: r.get(23)?,
        additional_directories: vec![],
    })
}
fn todo_row(r: &Row<'_>) -> rusqlite::Result<Todo> {
    Ok(Todo {
        id: r.get(0)?,
        project_id: r.get(1)?,
        workstream_id: r.get(2)?,
        origin_workstream_id: r.get(3)?,
        title: r.get(4)?,
        description: r.get(5)?,
        status: r.get(6)?,
        session_id: r.get(7)?,
        created_at: r.get(8)?,
        updated_at: r.get(9)?,
    })
}

const TODO_COLUMNS: &str = "id,project_id,workstream_id,origin_workstream_id,title,description,status,session_id,created_at,updated_at";

const SETTLEMENT_OPERATION_COLUMNS: &str = "workstream_id,phase,code_action,todo_action,keep_session_history,delete_worktree,delete_branch,commit_message,before_head,source_head,target_head,integrated_commit,error,started_at,updated_at";

fn settlement_operation_row(r: &Row<'_>) -> rusqlite::Result<SettlementOperation> {
    Ok(SettlementOperation {
        workstream_id: r.get(0)?,
        phase: r.get(1)?,
        code_action: r.get(2)?,
        todo_action: r.get(3)?,
        keep_session_history: r.get(4)?,
        delete_worktree: r.get(5)?,
        delete_branch: r.get(6)?,
        commit_message: r.get(7)?,
        before_head: r.get(8)?,
        source_head: r.get(9)?,
        target_head: r.get(10)?,
        integrated_commit: r.get(11)?,
        error: r.get(12)?,
        started_at: r.get(13)?,
        updated_at: r.get(14)?,
    })
}

const REBASE_OPERATION_COLUMNS: &str = "id,workstream_id,status,phase,before_head,parent_head,rebased_head,recovery_ref,error,started_at,updated_at,completed_at";

fn rebase_operation_row(r: &Row<'_>) -> rusqlite::Result<RebaseOperation> {
    Ok(RebaseOperation {
        id: r.get(0)?,
        workstream_id: r.get(1)?,
        status: r.get(2)?,
        phase: r.get(3)?,
        before_head: r.get(4)?,
        parent_head: r.get(5)?,
        rebased_head: r.get(6)?,
        recovery_ref: r.get(7)?,
        error: r.get(8)?,
        started_at: r.get(9)?,
        updated_at: r.get(10)?,
        completed_at: r.get(11)?,
    })
}

const RESET_OPERATION_COLUMNS: &str = "id,workstream_id,status,mode,before_head,target_head,result_head,recovery_ref,error,started_at,updated_at,completed_at";

fn reset_operation_row(r: &Row<'_>) -> rusqlite::Result<ResetOperation> {
    Ok(ResetOperation {
        id: r.get(0)?,
        workstream_id: r.get(1)?,
        status: r.get(2)?,
        mode: r.get(3)?,
        before_head: r.get(4)?,
        target_head: r.get(5)?,
        result_head: r.get(6)?,
        recovery_ref: r.get(7)?,
        error: r.get(8)?,
        started_at: r.get(9)?,
        updated_at: r.get(10)?,
        completed_at: r.get(11)?,
    })
}

fn settlement_preflight_row(r: &Row<'_>) -> rusqlite::Result<SettlementPreflight> {
    Ok(SettlementPreflight {
        id: r.get(0)?,
        workstream_id: r.get(1)?,
        code_action: r.get(2)?,
        source_head: r.get(3)?,
        target_head: r.get(4)?,
        target_branch: r.get(5)?,
        source_status: r.get(6)?,
        source_dirty: r.get(7)?,
        target_dirty: r.get(8)?,
        ahead: r.get(9)?,
        behind: r.get(10)?,
        changed_files: decode_json_column(r, 11)?,
        commits: decode_json_column(r, 12)?,
        diff_stat: r.get(13)?,
        blockers: decode_json_column(r, 14)?,
        warnings: decode_json_column(r, 15)?,
        created_at: r.get(16)?,
    })
}

fn decode_json_column<T: DeserializeOwned>(r: &Row<'_>, index: usize) -> rusqlite::Result<T> {
    let value: String = r.get(index)?;
    serde_json::from_str(&value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            index,
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })
}

fn migrate_development_schema(connection: &Connection) -> Result<()> {
    let exists: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='projects')",
        [],
        |row| row.get(0),
    )?;
    if !exists {
        return Ok(());
    }
    let add = |table: &str, column: &str, sql: &str| -> Result<()> {
        let mut stmt = connection.prepare(&format!("PRAGMA table_info({table})"))?;
        let names = stmt
            .query_map([], |row| row.get::<_, String>(1))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        if !names.iter().any(|name| name == column) {
            connection.execute_batch(sql)?;
        }
        Ok(())
    };
    add(
        "projects",
        "base_branch",
        "ALTER TABLE projects ADD COLUMN base_branch TEXT NOT NULL DEFAULT 'main';",
    )?;
    add(
        "projects",
        "status",
        "ALTER TABLE projects ADD COLUMN status TEXT NOT NULL DEFAULT 'active';",
    )?;
    add(
        "project_directories",
        "worktree_setup_command",
        "ALTER TABLE project_directories ADD COLUMN worktree_setup_command TEXT NOT NULL DEFAULT '';",
    )?;
    add(
        "workstreams",
        "kind",
        "ALTER TABLE workstreams ADD COLUMN kind TEXT NOT NULL DEFAULT 'workstream';",
    )?;
    add(
        "workstreams",
        "parent_workstream_id",
        "ALTER TABLE workstreams ADD COLUMN parent_workstream_id TEXT;",
    )?;
    add(
        "workstreams",
        "forked_from_commit",
        "ALTER TABLE workstreams ADD COLUMN forked_from_commit TEXT;",
    )?;
    add(
        "workstreams",
        "integration_status",
        "ALTER TABLE workstreams ADD COLUMN integration_status TEXT NOT NULL DEFAULT 'none';",
    )?;
    add(
        "workstreams",
        "close_outcome",
        "ALTER TABLE workstreams ADD COLUMN close_outcome TEXT;",
    )?;
    add(
        "workstreams",
        "integrated_commit",
        "ALTER TABLE workstreams ADD COLUMN integrated_commit TEXT;",
    )?;
    add(
        "workstreams",
        "closed_at",
        "ALTER TABLE workstreams ADD COLUMN closed_at TEXT;",
    )?;
    add(
        "sessions",
        "original_cwd",
        "ALTER TABLE sessions ADD COLUMN original_cwd TEXT NOT NULL DEFAULT '';",
    )?;
    connection.execute(
        "UPDATE sessions SET original_cwd=cwd WHERE original_cwd=''",
        [],
    )?;

    let mut stmt = connection.prepare("PRAGMA table_info(todos)")?;
    let todo_columns = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if !todo_columns.iter().any(|name| name == "project_id") {
        connection.execute_batch(
            "ALTER TABLE todos RENAME TO todos_legacy;
             CREATE TABLE todos (
               id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
               workstream_id TEXT REFERENCES workstreams(id) ON DELETE CASCADE,
               origin_workstream_id TEXT REFERENCES workstreams(id) ON DELETE SET NULL,
               title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
               session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
               created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
               CHECK ((project_id IS NULL) != (workstream_id IS NULL))
             );
             INSERT INTO todos(id,workstream_id,title,description,status,session_id,created_at,updated_at)
             SELECT id,workstream_id,title,description,status,session_id,created_at,updated_at FROM todos_legacy;
             DROP TABLE todos_legacy;",
        )?;
    }
    let settlement_exists: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='settlement_operations')",
        [],
        |row| row.get(0),
    )?;
    if settlement_exists {
        let mut stmt = connection.prepare("PRAGMA table_info(settlement_operations)")?;
        let settlement_columns = stmt
            .query_map([], |row| row.get::<_, String>(1))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        if settlement_columns
            .iter()
            .any(|name| name == "context_action")
        {
            connection
                .execute_batch("ALTER TABLE settlement_operations DROP COLUMN context_action;")?;
        }
    }
    let preflight_exists: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='settlement_preflights')",
        [],
        |row| row.get(0),
    )?;
    if preflight_exists {
        for column in [
            "verification_command",
            "verification_status",
            "verification_output",
        ] {
            let mut stmt = connection.prepare("PRAGMA table_info(settlement_preflights)")?;
            let columns = stmt
                .query_map([], |row| row.get::<_, String>(1))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            if columns.iter().any(|name| name == column) {
                connection.execute_batch(&format!(
                    "ALTER TABLE settlement_preflights DROP COLUMN {column};"
                ))?;
            }
        }
    }
    let legacy_session_directories_exist: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='session_context_paths')",
        [],
        |row| row.get(0),
    )?;
    if legacy_session_directories_exist {
        let current_session_directories_exist: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='session_additional_directories')",
            [],
            |row| row.get(0),
        )?;
        if current_session_directories_exist {
            connection.execute_batch(
                "INSERT OR IGNORE INTO session_additional_directories(session_id,path)
                   SELECT session_id,path FROM session_context_paths;
                 DROP TABLE session_context_paths;",
            )?;
        } else {
            connection.execute_batch(
                "ALTER TABLE session_context_paths RENAME TO session_additional_directories;",
            )?;
        }
    }
    connection.execute_batch(
        "DROP TABLE IF EXISTS workstream_contexts;
         DROP TABLE IF EXISTS project_contexts;",
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::{Store, SCHEMA};

    #[test]
    fn initializes_a_fresh_database() {
        let root =
            std::env::temp_dir().join(format!("treefold-store-test-{}", uuid::Uuid::new_v4()));
        let path = root.join("treefold.db");
        let store = Store::open(&path).expect("open store");
        assert!(store.projects().expect("list projects").is_empty());
        drop(store);
        let connection = Connection::open(&path).expect("reopen database");
        let settings_table_exists: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='settings')",
                [],
                |row| row.get(0),
            )
            .expect("inspect settings table");
        assert!(
            !settings_table_exists,
            "user settings must not live in SQLite"
        );
        drop(connection);
        std::fs::remove_dir_all(root).expect("remove temporary database");
    }

    #[test]
    fn removes_legacy_context_schema_without_losing_settlement_history() {
        let root = std::env::temp_dir().join(format!(
            "treefold-context-migration-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).expect("create temporary directory");
        let path = root.join("treefold.db");
        let connection = Connection::open(&path).expect("open legacy database");
        connection
            .execute_batch(SCHEMA)
            .expect("create current schema");
        connection
            .execute_batch(
                "ALTER TABLE project_directories DROP COLUMN worktree_setup_command;
                 ALTER TABLE settlement_preflights
                   ADD COLUMN verification_command TEXT NOT NULL DEFAULT '[]';
                 ALTER TABLE settlement_preflights
                   ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'not_run';
                 ALTER TABLE settlement_preflights
                   ADD COLUMN verification_output TEXT NOT NULL DEFAULT '';
                 CREATE TABLE project_contexts (
                   id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
                   key TEXT NOT NULL, value TEXT NOT NULL,
                   created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                 );
                 CREATE TABLE workstream_contexts (
                   id TEXT PRIMARY KEY, workstream_id TEXT NOT NULL,
                   key TEXT NOT NULL, value TEXT NOT NULL,
                   created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                 );
                 CREATE TABLE session_context_paths (
                   session_id TEXT NOT NULL, path TEXT NOT NULL,
                   PRIMARY KEY(session_id,path)
                 );
                 ALTER TABLE settlement_operations
                   ADD COLUMN context_action TEXT NOT NULL DEFAULT 'carry';
                 INSERT INTO projects VALUES(
                   'project-1','Project','', 'active','directory-1','main','now','now'
                 );
                 INSERT INTO project_directories VALUES(
                   'directory-1','project-1','repo','','/tmp/repo','primary',1,'now'
                 );
                 INSERT INTO workstreams VALUES(
                   'workstream-1','project-1','Work','', 'active','workstream',NULL,
                   'managed_worktree','directory-1',NULL,'/tmp/worktree','main','head',
                   'treefold/work',NULL,'none',NULL,NULL,NULL,'','','now','now'
                 );
                 INSERT INTO sessions(
                   id,workstream_id,name,kind,cwd,original_cwd,initial_prompt,yolo,
                   sidebar_visible,process_id,process_name,status,pid,process_group_id,
                   exit_signal,command,launch_started_at,created_at,updated_at
                 ) VALUES(
                   'session-1','workstream-1','Codex','codex','/tmp/worktree',
                   '/tmp/worktree','',0,1,'','','closed',0,0,'','[]','now','now','now'
                 );
                 INSERT INTO session_context_paths VALUES('session-1','/tmp/legacy-attached');
                 INSERT INTO settlement_operations(
                   workstream_id,phase,code_action,todo_action,keep_session_history,
                   delete_worktree,delete_branch,commit_message,before_head,source_head,
                   target_head,integrated_commit,error,started_at,updated_at,context_action
                 ) VALUES(
                   'workstream-1','code_integrated','merge','carry',1,1,1,'','before',
                   'source','target',NULL,'','now','now','carry'
                 );",
            )
            .expect("seed legacy context schema");
        drop(connection);

        let store = Store::open(&path).expect("migrate legacy database");
        let db = store.0.lock();
        for table in [
            "project_contexts",
            "workstream_contexts",
            "session_context_paths",
        ] {
            let exists: bool = db
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?)",
                    [table],
                    |row| row.get(0),
                )
                .expect("inspect migrated tables");
            assert!(!exists, "{table} should be removed");
        }
        let columns = db
            .prepare("PRAGMA table_info(settlement_operations)")
            .expect("inspect settlement schema")
            .query_map([], |row| row.get::<_, String>(1))
            .expect("read settlement columns")
            .collect::<rusqlite::Result<Vec<_>>>()
            .expect("collect settlement columns");
        assert!(!columns.iter().any(|name| name == "context_action"));
        let preflight_columns = db
            .prepare("PRAGMA table_info(settlement_preflights)")
            .expect("inspect settlement preflight schema")
            .query_map([], |row| row.get::<_, String>(1))
            .expect("read settlement preflight columns")
            .collect::<rusqlite::Result<Vec<_>>>()
            .expect("collect settlement preflight columns");
        for removed in [
            "verification_command",
            "verification_status",
            "verification_output",
        ] {
            assert!(!preflight_columns.iter().any(|name| name == removed));
        }
        let operation_count: i64 = db
            .query_row("SELECT COUNT(*) FROM settlement_operations", [], |row| {
                row.get(0)
            })
            .expect("count settlement history");
        assert_eq!(operation_count, 1);
        let foreign_key_violations: i64 = db
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })
            .expect("check migrated foreign keys");
        assert_eq!(foreign_key_violations, 0);
        drop(db);
        assert_eq!(
            store
                .directory("directory-1")
                .expect("read migrated Directory")
                .worktree_setup_command,
            ""
        );
        assert_eq!(
            store
                .session("session-1")
                .expect("read migrated Session")
                .additional_directories,
            ["/tmp/legacy-attached"]
        );
        store
            .replace_session_additional_directories("session-1", &["/tmp/current-attached".into()])
            .expect("refresh Session directories");
        assert_eq!(
            store
                .session("session-1")
                .expect("read refreshed Session")
                .additional_directories,
            ["/tmp/current-attached"]
        );
        drop(store);
        std::fs::remove_dir_all(root).expect("remove temporary database");
    }
}
