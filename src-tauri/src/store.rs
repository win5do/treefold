use std::{path::Path, sync::Arc};

use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::de::DeserializeOwned;

use crate::{
    error::{AppError, Result},
    model::*,
};

#[derive(Clone)]
pub struct Store(Arc<Mutex<Connection>>);

const SCHEMA: &str = r#"
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS projects (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'active',
 default_location_id TEXT,
 default_base_branch TEXT NOT NULL DEFAULT 'main',
 default_delivery_mode TEXT NOT NULL DEFAULT 'remote_review',
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_locations (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 worktree_setup_command TEXT NOT NULL DEFAULT '', path TEXT NOT NULL,
 repository_url TEXT, preferred_remote_name TEXT, base_branch TEXT, delivery_mode TEXT,
 git_common_dir TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(project_id,path)
);
CREATE TABLE IF NOT EXISTS workspaces (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
 kind TEXT NOT NULL DEFAULT 'workspace', parent_workspace_id TEXT REFERENCES workspaces(id),
 runtime_id TEXT NOT NULL DEFAULT '', runtime_name TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workspace_locations (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 project_location_id TEXT NOT NULL REFERENCES project_locations(id),
 location_name TEXT NOT NULL, source_path TEXT NOT NULL, access_mode TEXT NOT NULL,
 git_status TEXT NOT NULL, worktree_id TEXT, checkout_path TEXT, branch TEXT,
 base_branch TEXT, start_commit TEXT, forked_from_commit TEXT,
 remote_name TEXT, remote_branch TEXT, branch_ownership TEXT NOT NULL DEFAULT 'managed',
 delivery_mode TEXT NOT NULL DEFAULT 'remote_review', delivery_status TEXT NOT NULL DEFAULT 'active',
 close_outcome TEXT, integrated_commit TEXT, closed_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(workspace_id,project_location_id)
);
CREATE INDEX IF NOT EXISTS workspace_locations_workspace ON workspace_locations(workspace_id);
CREATE TRIGGER IF NOT EXISTS projects_default_location_insert
BEFORE INSERT ON projects WHEN NEW.default_location_id IS NOT NULL
BEGIN SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM project_locations WHERE id=NEW.default_location_id AND project_id=NEW.id AND git_common_dir IS NOT NULL
) THEN RAISE(ABORT,'default location must be a Git location in this Project') END; END;
CREATE TRIGGER IF NOT EXISTS projects_default_location_update
BEFORE UPDATE OF default_location_id ON projects WHEN NEW.default_location_id IS NOT NULL
BEGIN SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM project_locations WHERE id=NEW.default_location_id AND project_id=NEW.id AND git_common_dir IS NOT NULL
) THEN RAISE(ABORT,'default location must be a Git location in this Project') END; END;
CREATE TABLE IF NOT EXISTS sessions (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
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
 access_mode TEXT NOT NULL DEFAULT 'read_write',
 PRIMARY KEY(session_id,path)
);
CREATE TABLE IF NOT EXISTS todos (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
 session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL, blocked_reason TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS delivery_operations (
 workspace_location_id TEXT PRIMARY KEY REFERENCES workspace_locations(id) ON DELETE CASCADE,
 phase TEXT NOT NULL, code_action TEXT NOT NULL, todo_action TEXT NOT NULL DEFAULT 'keep',
 push_after_merge INTEGER NOT NULL DEFAULT 0,
 keep_session_history INTEGER NOT NULL,
 delete_worktree INTEGER NOT NULL, delete_branch INTEGER NOT NULL,
 commit_message TEXT NOT NULL DEFAULT '', before_head TEXT NOT NULL DEFAULT '',
 source_head TEXT NOT NULL DEFAULT '', target_head TEXT NOT NULL DEFAULT '',
 integrated_commit TEXT, error TEXT NOT NULL DEFAULT '',
 started_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rebase_operations (
 id TEXT PRIMARY KEY, workspace_location_id TEXT NOT NULL REFERENCES workspace_locations(id) ON DELETE CASCADE,
 status TEXT NOT NULL, phase TEXT NOT NULL, before_head TEXT NOT NULL,
 target_head TEXT NOT NULL, rebased_head TEXT, recovery_ref TEXT NOT NULL,
 error TEXT NOT NULL DEFAULT '', started_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 completed_at TEXT
);
CREATE INDEX IF NOT EXISTS rebase_operations_location_updated
 ON rebase_operations(workspace_location_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS delivery_preflights (
 id TEXT PRIMARY KEY, workspace_location_id TEXT NOT NULL REFERENCES workspace_locations(id) ON DELETE CASCADE,
 code_action TEXT NOT NULL, source_head TEXT NOT NULL, target_head TEXT NOT NULL,
 target_branch TEXT NOT NULL, source_status TEXT NOT NULL, source_dirty INTEGER NOT NULL,
 target_dirty INTEGER NOT NULL, ahead INTEGER NOT NULL, behind INTEGER NOT NULL,
 changed_files TEXT NOT NULL, commits TEXT NOT NULL, diff_stat TEXT NOT NULL,
 blockers TEXT NOT NULL, warnings TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS delivery_preflights_location_created
 ON delivery_preflights(workspace_location_id,created_at DESC);
CREATE TABLE IF NOT EXISTS reset_operations (
 id TEXT PRIMARY KEY, workspace_location_id TEXT NOT NULL REFERENCES workspace_locations(id) ON DELETE CASCADE,
 status TEXT NOT NULL, mode TEXT NOT NULL, before_head TEXT NOT NULL,
 target_head TEXT NOT NULL, result_head TEXT, recovery_ref TEXT NOT NULL,
 error TEXT NOT NULL DEFAULT '', started_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 completed_at TEXT
);
CREATE INDEX IF NOT EXISTS reset_operations_location_started
 ON reset_operations(workspace_location_id,started_at DESC);
DROP TABLE IF EXISTS settings;
"#;

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(anyhow::Error::from)?;
        }
        let connection = Connection::open(path)?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        migrate_development_schema(&connection, path)?;
        connection.execute_batch("PRAGMA journal_mode=WAL;")?;
        connection.execute_batch(SCHEMA)?;
        Ok(Self(Arc::new(Mutex::new(connection))))
    }

    pub fn projects(&self) -> Result<Vec<Project>> {
        let db = self.0.lock();
        let mut stmt = db.prepare("SELECT id,name,description,status,default_location_id,default_base_branch,default_delivery_mode,created_at,updated_at FROM projects ORDER BY updated_at DESC")?;
        let mut values = stmt
            .query_map([], project_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for project in &mut values {
            hydrate_project_compat(&db, project)?;
        }
        Ok(values)
    }

    pub fn project(&self, id: &str) -> Result<Project> {
        let db = self.0.lock();
        let mut project = db.query_row("SELECT id,name,description,status,default_location_id,default_base_branch,default_delivery_mode,created_at,updated_at FROM projects WHERE id=?", [id], project_row)?;
        hydrate_project_compat(&db, &mut project)?;
        Ok(project)
    }

    pub fn create_empty_project(&self, p: &Project) -> Result<()> {
        self.0.lock().execute(
            "INSERT INTO projects(id,name,description,status,default_location_id,default_base_branch,default_delivery_mode,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
            params![p.id,p.name,p.description,p.status,p.default_location_id,p.default_base_branch,p.default_delivery_mode,p.created_at,p.updated_at],
        )?;
        Ok(())
    }

    pub fn update_project_defaults(
        &self,
        id: &str,
        default_location_id: Option<&str>,
        default_base_branch: &str,
        default_delivery_mode: &str,
    ) -> Result<()> {
        let changed = self.0.lock().execute(
            "UPDATE projects SET default_location_id=?,default_base_branch=?,default_delivery_mode=?,updated_at=? WHERE id=?",
            params![default_location_id,default_base_branch,default_delivery_mode,now(),id],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound);
        }
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
        let mut stmt = db.prepare("SELECT id,project_id,name,description,worktree_setup_command,path,repository_url,preferred_remote_name,base_branch,delivery_mode,git_common_dir,created_at,updated_at FROM project_locations WHERE project_id=? ORDER BY name")?;
        let values = stmt
            .query_map([project_id], directory_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(values)
    }

    pub fn directory(&self, id: &str) -> Result<Directory> {
        let db = self.0.lock();
        Ok(db.query_row("SELECT id,project_id,name,description,worktree_setup_command,path,repository_url,preferred_remote_name,base_branch,delivery_mode,git_common_dir,created_at,updated_at FROM project_locations WHERE id=?", [id], directory_row)?)
    }

    pub fn create_directory(&self, d: &Directory) -> Result<()> {
        let mut db = self.0.lock();
        let tx = db.transaction()?;
        insert_project_location(&tx, d)?;
        if d.git_common_dir.is_some() {
            tx.execute("UPDATE projects SET default_location_id=COALESCE(default_location_id,?),updated_at=? WHERE id=?", params![d.id,now(),d.project_id])?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn update_directory(
        &self,
        id: &str,
        description: &str,
        worktree_setup_command: &str,
        base_branch: Option<&str>,
        delivery_mode: Option<&str>,
    ) -> Result<()> {
        self.0.lock().execute(
            "UPDATE project_locations SET description=?,worktree_setup_command=?,base_branch=?,delivery_mode=?,updated_at=? WHERE id=?",
            params![description, worktree_setup_command, base_branch, delivery_mode, now(), id],
        )?;
        Ok(())
    }

    pub fn refresh_project_location(&self, location: &ProjectLocation) -> Result<()> {
        let changed = self.0.lock().execute(
            "UPDATE project_locations SET path=?,name=?,repository_url=?,preferred_remote_name=?,base_branch=?,delivery_mode=?,git_common_dir=?,updated_at=? WHERE id=?",
            params![location.path,location.name,location.repository_url,location.preferred_remote_name,location.base_branch,location.delivery_mode,location.git_common_dir,location.updated_at,location.id],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }

    pub fn reattach_project_location(
        &self,
        id: &str,
        path: &str,
        git_common_dir: &str,
        repository_url: Option<&str>,
        preferred_remote_name: Option<&str>,
    ) -> Result<()> {
        let changed = self.0.lock().execute(
            "UPDATE project_locations SET path=?,git_common_dir=?,repository_url=?,preferred_remote_name=?,updated_at=? WHERE id=?",
            params![path,git_common_dir,repository_url,preferred_remote_name,now(),id],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }

    pub fn delete_project_location(&self, id: &str) -> Result<()> {
        let db = self.0.lock();
        let referenced: bool = db.query_row(
            "SELECT EXISTS(SELECT 1 FROM workspace_locations WHERE project_location_id=?)",
            [id],
            |r| r.get(0),
        )?;
        if referenced {
            return Err(AppError::BadRequest(
                "location is snapshotted by an existing Workspace".into(),
            ));
        }
        let changed = db.execute("DELETE FROM project_locations WHERE id=?", [id])?;
        if changed == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }

    pub fn workspaces(&self, project_id: &str) -> Result<Vec<Workspace>> {
        let db = self.0.lock();
        let mut stmt = db.prepare(&format!("SELECT {WORKSPACE_COLUMNS} FROM workspaces WHERE project_id=? ORDER BY updated_at DESC"))?;
        let mut values = stmt
            .query_map([project_id], workspace_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for workspace in &mut values {
            hydrate_workspace_compat(&db, workspace)?;
        }
        Ok(values)
    }

    pub fn workspace(&self, id: &str) -> Result<Workspace> {
        let db = self.0.lock();
        let mut workspace = db.query_row(
            &format!("SELECT {WORKSPACE_COLUMNS} FROM workspaces WHERE id=?"),
            [id],
            workspace_row,
        )?;
        hydrate_workspace_compat(&db, &mut workspace)?;
        Ok(workspace)
    }

    pub fn create_workspace_with_locations(
        &self,
        w: &Workspace,
        locations: &[WorkspaceLocation],
    ) -> Result<()> {
        let mut db = self.0.lock();
        let tx = db.transaction()?;
        tx.execute("INSERT INTO workspaces(id,project_id,name,description,status,kind,parent_workspace_id,runtime_id,runtime_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)", params![w.id,w.project_id,w.name,w.description,w.status,w.kind,w.parent_workspace_id,w.runtime_id,w.runtime_name,w.created_at,w.updated_at])?;
        for location in locations {
            insert_workspace_location(&tx, location)?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn workspace_locations(&self, workspace_id: &str) -> Result<Vec<WorkspaceLocation>> {
        let db = self.0.lock();
        let mut stmt = db.prepare(&format!("SELECT {WORKSPACE_LOCATION_COLUMNS} FROM workspace_locations WHERE workspace_id=? ORDER BY location_name"))?;
        let values = stmt
            .query_map([workspace_id], workspace_location_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(values)
    }

    pub fn workspace_location(&self, id: &str) -> Result<WorkspaceLocation> {
        let db = self.0.lock();
        Ok(db.query_row(
            &format!("SELECT {WORKSPACE_LOCATION_COLUMNS} FROM workspace_locations WHERE id=?"),
            [id],
            workspace_location_row,
        )?)
    }

    pub fn workspace_locations_for_project_location(
        &self,
        project_location_id: &str,
    ) -> Result<Vec<WorkspaceLocation>> {
        let db = self.0.lock();
        let mut stmt = db.prepare(&format!("SELECT {WORKSPACE_LOCATION_COLUMNS} FROM workspace_locations WHERE project_location_id=? ORDER BY created_at"))?;
        let values = stmt
            .query_map([project_location_id], workspace_location_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(values)
    }

    pub fn default_workspace_location(&self, workspace_id: &str) -> Result<WorkspaceLocation> {
        let db = self.0.lock();
        Ok(db.query_row(&format!("SELECT {WORKSPACE_LOCATION_JOIN_COLUMNS} FROM workspace_locations wl JOIN workspaces w ON w.id=wl.workspace_id JOIN projects p ON p.id=w.project_id WHERE wl.workspace_id=? ORDER BY wl.project_location_id=p.default_location_id DESC LIMIT 1"), [workspace_id], workspace_location_row)?)
    }

    fn resolve_workspace_location_id(&self, workspace_or_location_id: &str) -> Result<String> {
        let db = self.0.lock();
        if let Some(id) = db
            .query_row(
                "SELECT id FROM workspace_locations WHERE id=?",
                [workspace_or_location_id],
                |r| r.get(0),
            )
            .optional()?
        {
            return Ok(id);
        }
        Ok(db.query_row("SELECT wl.id FROM workspace_locations wl JOIN workspaces w ON w.id=wl.workspace_id JOIN projects p ON p.id=w.project_id WHERE wl.workspace_id=? ORDER BY wl.project_location_id=p.default_location_id DESC LIMIT 1", [workspace_or_location_id], |r| r.get(0))?)
    }

    pub(crate) fn forks(&self, workspace_id: &str) -> Result<Vec<Workspace>> {
        let db = self.0.lock();
        let mut stmt = db.prepare(&format!("SELECT {WORKSPACE_COLUMNS} FROM workspaces WHERE parent_workspace_id=? ORDER BY updated_at DESC"))?;
        let values = stmt
            .query_map([workspace_id], workspace_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(values)
    }

    pub fn finish_workspace(
        &self,
        id: &str,
        delivery_status: &str,
        close_outcome: &str,
        integrated_commit: Option<&str>,
        timestamp: &str,
    ) -> Result<()> {
        let mut db = self.0.lock();
        let tx = db.transaction()?;
        tx.execute("UPDATE workspace_locations SET delivery_status=?,close_outcome=?,integrated_commit=?,closed_at=?,updated_at=? WHERE workspace_id=?", params![delivery_status,close_outcome,integrated_commit,timestamp,timestamp,id])?;
        tx.execute(
            "UPDATE workspaces SET status='archived',updated_at=? WHERE id=?",
            params![timestamp, id],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn finish_workspace_location(
        &self,
        id: &str,
        delivery_status: &str,
        close_outcome: &str,
        integrated_commit: Option<&str>,
        timestamp: &str,
    ) -> Result<()> {
        let changed = self.0.lock().execute(
            "UPDATE workspace_locations SET delivery_status=?,close_outcome=?,integrated_commit=?,closed_at=?,updated_at=? WHERE id=?",
            params![delivery_status,close_outcome,integrated_commit,timestamp,timestamp,id],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }

    pub fn archive_workspace(&self, id: &str) -> Result<()> {
        let db = self.0.lock();
        let unfinished: bool = db.query_row(
            "SELECT EXISTS(SELECT 1 FROM workspace_locations WHERE workspace_id=? AND access_mode='read_write' AND delivery_status NOT IN ('delivered','kept','discarded','remote_merged'))",
            [id], |r| r.get(0),
        )?;
        if unfinished {
            return Err(AppError::BadRequest(
                "all Git locations must be finished before archiving the Workspace".into(),
            ));
        }
        let changed = db.execute(
            "UPDATE workspaces SET status='archived',updated_at=? WHERE id=?",
            params![now(), id],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }

    pub fn set_delivery_status(&self, id: &str, status: &str) -> Result<()> {
        let location_id = self.resolve_workspace_location_id(id)?;
        self.0.lock().execute(
            "UPDATE workspace_locations SET delivery_status=?,updated_at=? WHERE id=?",
            params![status, now(), location_id],
        )?;
        Ok(())
    }

    pub fn update_workspace_delivery(
        &self,
        id: &str,
        remote_name: Option<&str>,
        remote_branch: Option<&str>,
        delivery_mode: &str,
    ) -> Result<()> {
        let location_id = self.resolve_workspace_location_id(id)?;
        let changed = self.0.lock().execute("UPDATE workspace_locations SET remote_name=?,remote_branch=?,delivery_mode=?,updated_at=? WHERE id=?", params![remote_name,remote_branch,delivery_mode,now(),location_id])?;
        if changed == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }

    pub fn delivery_operation(&self, workspace_id: &str) -> Result<Option<DeliveryOperation>> {
        let location_id = self.resolve_workspace_location_id(workspace_id)?;
        let db = self.0.lock();
        Ok(db
            .query_row(
                &format!(
                    "SELECT {SETTLEMENT_OPERATION_COLUMNS} FROM delivery_operations WHERE workspace_location_id=?"
                ),
                [location_id],
                delivery_operation_row,
            )
            .optional()?)
    }

    pub fn create_delivery_operation(&self, operation: &DeliveryOperation) -> Result<()> {
        self.0.lock().execute(
            "INSERT INTO delivery_operations(workspace_location_id,phase,code_action,todo_action,push_after_merge,keep_session_history,delete_worktree,delete_branch,commit_message,before_head,source_head,target_head,integrated_commit,error,started_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            params![
                operation.workspace_location_id,
                operation.phase,
                operation.code_action,
                operation.todo_action,
                operation.push_after_merge,
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

    pub fn advance_delivery(
        &self,
        workspace_id: &str,
        phase: &str,
        source_head: Option<&str>,
        target_head: Option<&str>,
        integrated_commit: Option<&str>,
    ) -> Result<()> {
        let location_id = self.resolve_workspace_location_id(workspace_id)?;
        self.0.lock().execute(
            "UPDATE delivery_operations SET phase=?,source_head=COALESCE(?,source_head),target_head=COALESCE(?,target_head),integrated_commit=COALESCE(?,integrated_commit),error='',updated_at=? WHERE workspace_location_id=?",
            params![phase, source_head, target_head, integrated_commit, now(), location_id],
        )?;
        Ok(())
    }

    pub fn set_delivery_error(&self, workspace_id: &str, error: &str) -> Result<()> {
        let location_id = self.resolve_workspace_location_id(workspace_id)?;
        self.0.lock().execute(
            "UPDATE delivery_operations SET error=?,updated_at=? WHERE workspace_location_id=?",
            params![error, now(), location_id],
        )?;
        Ok(())
    }

    pub fn latest_rebase_operation(&self, workspace_id: &str) -> Result<Option<RebaseOperation>> {
        let location_id = self.resolve_workspace_location_id(workspace_id)?;
        let db = self.0.lock();
        Ok(db
            .query_row(
                &format!(
                    "SELECT {REBASE_OPERATION_COLUMNS} FROM rebase_operations WHERE workspace_location_id=? ORDER BY updated_at DESC,rowid DESC LIMIT 1"
                ),
                [location_id],
                rebase_operation_row,
            )
            .optional()?)
    }

    pub fn rebase_operations(&self, workspace_id: &str) -> Result<Vec<RebaseOperation>> {
        let location_id = self.resolve_workspace_location_id(workspace_id)?;
        let db = self.0.lock();
        let mut stmt = db.prepare(&format!(
            "SELECT {REBASE_OPERATION_COLUMNS} FROM rebase_operations WHERE workspace_location_id=? ORDER BY started_at DESC,rowid DESC"
        ))?;
        let values = stmt
            .query_map([location_id], rebase_operation_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(values)
    }

    pub fn create_rebase_operation(&self, operation: &RebaseOperation) -> Result<()> {
        self.0.lock().execute(
            "INSERT INTO rebase_operations(id,workspace_location_id,status,phase,before_head,target_head,rebased_head,recovery_ref,error,started_at,updated_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            params![
                operation.id,
                operation.workspace_location_id,
                operation.status,
                operation.phase,
                operation.before_head,
                operation.target_head,
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

    pub fn create_delivery_preflight(&self, preflight: &DeliveryPreflight) -> Result<()> {
        self.0.lock().execute(
            "INSERT INTO delivery_preflights(id,workspace_location_id,code_action,source_head,target_head,target_branch,source_status,source_dirty,target_dirty,ahead,behind,changed_files,commits,diff_stat,blockers,warnings,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            params![
                preflight.id,
                preflight.workspace_location_id,
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

    pub fn delivery_preflight(&self, id: &str) -> Result<DeliveryPreflight> {
        let db = self.0.lock();
        Ok(db.query_row(
            "SELECT id,workspace_location_id,code_action,source_head,target_head,target_branch,source_status,source_dirty,target_dirty,ahead,behind,changed_files,commits,diff_stat,blockers,warnings,created_at FROM delivery_preflights WHERE id=?",
            [id],
            delivery_preflight_row,
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

    pub fn latest_reset_operation(&self, workspace_id: &str) -> Result<Option<ResetOperation>> {
        let location_id = self.resolve_workspace_location_id(workspace_id)?;
        let db = self.0.lock();
        Ok(db
            .query_row(
                &format!("SELECT {RESET_OPERATION_COLUMNS} FROM reset_operations WHERE workspace_location_id=? ORDER BY started_at DESC,rowid DESC LIMIT 1"),
                [location_id],
                reset_operation_row,
            )
            .optional()?)
    }

    pub fn reset_operations(&self, workspace_id: &str) -> Result<Vec<ResetOperation>> {
        let location_id = self.resolve_workspace_location_id(workspace_id)?;
        let db = self.0.lock();
        let mut stmt = db.prepare(&format!(
            "SELECT {RESET_OPERATION_COLUMNS} FROM reset_operations WHERE workspace_location_id=? ORDER BY started_at DESC,rowid DESC"
        ))?;
        let values = stmt
            .query_map([location_id], reset_operation_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(values)
    }

    pub fn create_reset_operation(&self, operation: &ResetOperation) -> Result<()> {
        self.0.lock().execute(
            "INSERT INTO reset_operations(id,workspace_location_id,status,mode,before_head,target_head,result_head,recovery_ref,error,started_at,updated_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            params![
                operation.id,
                operation.workspace_location_id,
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

    pub fn sessions(&self, workspace_id: &str) -> Result<Vec<Session>> {
        let db = self.0.lock();
        let mut stmt = db.prepare(&format!(
            "SELECT {SESSION_COLUMNS} FROM sessions WHERE workspace_id=? ORDER BY created_at DESC"
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
        tx.execute("INSERT INTO sessions(id,workspace_id,name,kind,cwd,original_cwd,initial_prompt,codex_session_id,yolo,sidebar_visible,hidden_at,evicted_at,process_id,process_name,status,pid,process_group_id,exit_code,exit_signal,command,launch_started_at,last_attached_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", params![s.id,s.workspace_id,s.name,s.kind,s.cwd,s.original_cwd,s.initial_prompt,s.codex_session_id,s.yolo,s.sidebar_visible,s.hidden_at,s.evicted_at,s.process_id,s.process_name,s.status,s.pid,s.process_group_id,s.exit_code,s.exit_signal,serde_json::to_string(&s.command).unwrap_or_default(),s.launch_started_at,s.last_attached_at,s.created_at,s.updated_at])?;
        for path in &s.additional_directories {
            tx.execute(
                "INSERT INTO session_additional_directories(session_id,path) VALUES(?,?)",
                params![s.id, path],
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
            db.execute("UPDATE sessions SET cwd=?,sidebar_visible=0,hidden_at=?,status='closed',pid=0,updated_at=? WHERE workspace_id=?", params![resume_cwd,timestamp,timestamp,workspace_id])?;
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
            .query_map([id], |r| r.get(0))?
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
                "INSERT INTO session_additional_directories(session_id,path) VALUES(?,?)",
                params![id, path],
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
                "INSERT OR REPLACE INTO session_additional_directories(session_id,path,access_mode) VALUES(?,?,'read_only')",
                params![id,path],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

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
            "INSERT INTO todos(id,workspace_id,title,description,status,session_id,blocked_reason,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
            params![
                t.id,
                t.workspace_id,
                t.title,
                t.description,
                t.status,
                t.session_id,
                t.blocked_reason,
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

    pub fn project_detail(&self, id: &str) -> Result<ProjectDetail> {
        let locations = self.directories(id)?;
        Ok(ProjectDetail {
            project: self.project(id)?,
            locations,
            workspaces: self
                .workspaces(id)?
                .into_iter()
                .filter(|workspace| workspace.kind == "workspace")
                .collect(),
            worktrees: Vec::new(),
        })
    }

    pub fn workspace_detail(&self, id: &str) -> Result<WorkspaceDetail> {
        let workspace = self.workspace(id)?;
        let locations = self.workspace_locations(id)?;
        Ok(WorkspaceDetail {
            project: self.project(&workspace.project_id)?,
            locations,
            sessions: self.sessions(id)?,
            todos: self.todos(id)?,
            forks: self.forks(id)?,
            workspace,
        })
    }
}

pub fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn project_row(r: &Row<'_>) -> rusqlite::Result<Project> {
    let default_location_id: Option<String> = r.get(4)?;
    let default_base_branch: String = r.get(5)?;
    Ok(Project {
        id: r.get(0)?,
        name: r.get(1)?,
        description: r.get(2)?,
        status: r.get(3)?,
        default_location_id: default_location_id.clone(),
        default_base_branch: default_base_branch.clone(),
        default_delivery_mode: r.get(6)?,
        created_at: r.get(7)?,
        updated_at: r.get(8)?,
        primary_directory_id: default_location_id.unwrap_or_default(),
        git_common_dir: String::new(),
        preferred_remote: None,
        default_target_branch: default_base_branch,
    })
}

fn hydrate_project_compat(db: &Connection, project: &mut Project) -> rusqlite::Result<()> {
    let Some(location_id) = project.default_location_id.as_deref() else {
        return Ok(());
    };
    let metadata = db.query_row(
        "SELECT git_common_dir,preferred_remote_name,COALESCE(base_branch,?),COALESCE(delivery_mode,?) FROM project_locations WHERE id=?",
        params![project.default_base_branch, project.default_delivery_mode, location_id],
        |r| Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?)),
    ).optional()?;
    if let Some((git_common_dir, remote, branch, delivery_mode)) = metadata {
        project.primary_directory_id = location_id.to_owned();
        project.git_common_dir = git_common_dir.unwrap_or_default();
        project.preferred_remote = remote;
        project.default_target_branch = branch;
        project.default_delivery_mode = delivery_mode;
    }
    Ok(())
}
fn directory_row(r: &Row<'_>) -> rusqlite::Result<Directory> {
    let git_common_dir: Option<String> = r.get(10)?;
    let is_git = git_common_dir.is_some();
    Ok(Directory {
        id: r.get(0)?,
        project_id: r.get(1)?,
        name: r.get(2)?,
        description: r.get(3)?,
        worktree_setup_command: r.get(4)?,
        path: r.get(5)?,
        repository_url: r.get(6)?,
        preferred_remote_name: r.get(7)?,
        base_branch: r.get(8)?,
        delivery_mode: r.get(9)?,
        git_common_dir,
        git_status: if is_git {
            "ready".into()
        } else {
            "not_git".into()
        },
        created_at: r.get(11)?,
        updated_at: r.get(12)?,
        checkout_path: None,
        role: "attached".into(),
        is_git,
        remote_url: r.get(6)?,
        branch: None,
        head_commit: None,
        head_summary: None,
        dirty: false,
    })
}
const WORKSPACE_COLUMNS: &str = "id,project_id,name,description,status,kind,parent_workspace_id,runtime_id,runtime_name,created_at,updated_at";
fn workspace_row(r: &Row<'_>) -> rusqlite::Result<Workspace> {
    Ok(Workspace {
        id: r.get(0)?,
        project_id: r.get(1)?,
        name: r.get(2)?,
        description: r.get(3)?,
        status: r.get(4)?,
        kind: r.get(5)?,
        parent_workspace_id: r.get(6)?,
        runtime_id: r.get(7)?,
        runtime_name: r.get(8)?,
        created_at: r.get(9)?,
        updated_at: r.get(10)?,
        checkout_mode: "worktree".into(),
        project_directory_id: String::new(),
        worktree_id: None,
        checkout_path: String::new(),
        target_branch: String::new(),
        start_commit: String::new(),
        branch: String::new(),
        forked_from_commit: None,
        remote_name: None,
        remote_branch: None,
        branch_ownership: "managed".into(),
        delivery_mode: "remote_review".into(),
        delivery_status: "active".into(),
        close_outcome: None,
        integrated_commit: None,
        closed_at: None,
    })
}

const WORKSPACE_LOCATION_COLUMNS: &str = "id,workspace_id,project_location_id,location_name,source_path,access_mode,git_status,worktree_id,checkout_path,branch,base_branch,start_commit,forked_from_commit,remote_name,remote_branch,branch_ownership,delivery_mode,delivery_status,close_outcome,integrated_commit,closed_at,created_at,updated_at";
const WORKSPACE_LOCATION_JOIN_COLUMNS: &str = "wl.id,wl.workspace_id,wl.project_location_id,wl.location_name,wl.source_path,wl.access_mode,wl.git_status,wl.worktree_id,wl.checkout_path,wl.branch,wl.base_branch,wl.start_commit,wl.forked_from_commit,wl.remote_name,wl.remote_branch,wl.branch_ownership,wl.delivery_mode,wl.delivery_status,wl.close_outcome,wl.integrated_commit,wl.closed_at,wl.created_at,wl.updated_at";

fn workspace_location_row(r: &Row<'_>) -> rusqlite::Result<WorkspaceLocation> {
    Ok(WorkspaceLocation {
        id: r.get(0)?,
        workspace_id: r.get(1)?,
        project_location_id: r.get(2)?,
        location_name: r.get(3)?,
        source_path: r.get(4)?,
        access_mode: r.get(5)?,
        git_status: r.get(6)?,
        worktree_id: r.get(7)?,
        checkout_path: r.get(8)?,
        branch: r.get(9)?,
        base_branch: r.get(10)?,
        start_commit: r.get(11)?,
        forked_from_commit: r.get(12)?,
        remote_name: r.get(13)?,
        remote_branch: r.get(14)?,
        branch_ownership: r.get(15)?,
        delivery_mode: r.get(16)?,
        delivery_status: r.get(17)?,
        close_outcome: r.get(18)?,
        integrated_commit: r.get(19)?,
        closed_at: r.get(20)?,
        created_at: r.get(21)?,
        updated_at: r.get(22)?,
    })
}

fn hydrate_workspace_compat(db: &Connection, workspace: &mut Workspace) -> rusqlite::Result<()> {
    let location = db.query_row(
        &format!("SELECT {WORKSPACE_LOCATION_JOIN_COLUMNS} FROM workspace_locations wl JOIN projects p ON p.id=? WHERE wl.workspace_id=? ORDER BY wl.project_location_id=p.default_location_id DESC LIMIT 1"),
        params![workspace.project_id, workspace.id], workspace_location_row,
    ).optional()?;
    if let Some(location) = location {
        workspace.project_directory_id = location.project_location_id;
        workspace.worktree_id = location.worktree_id;
        workspace.checkout_path = location
            .checkout_path
            .unwrap_or_else(|| location.source_path.clone());
        workspace.target_branch = location.base_branch.unwrap_or_default();
        workspace.start_commit = location.start_commit.unwrap_or_default();
        workspace.branch = location.branch.unwrap_or_default();
        workspace.forked_from_commit = location.forked_from_commit;
        workspace.remote_name = location.remote_name;
        workspace.remote_branch = location.remote_branch;
        workspace.branch_ownership = location.branch_ownership;
        workspace.delivery_mode = location.delivery_mode;
        workspace.delivery_status = location.delivery_status;
        workspace.close_outcome = location.close_outcome;
        workspace.integrated_commit = location.integrated_commit;
        workspace.closed_at = location.closed_at;
    }
    Ok(())
}

fn insert_project_location(
    tx: &rusqlite::Transaction<'_>,
    d: &ProjectLocation,
) -> rusqlite::Result<()> {
    tx.execute("INSERT INTO project_locations(id,project_id,name,description,worktree_setup_command,path,repository_url,preferred_remote_name,base_branch,delivery_mode,git_common_dir,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", params![d.id,d.project_id,d.name,d.description,d.worktree_setup_command,d.path,d.repository_url,d.preferred_remote_name,d.base_branch,d.delivery_mode,d.git_common_dir,d.created_at,d.updated_at])?;
    Ok(())
}

fn insert_workspace_location(
    tx: &rusqlite::Transaction<'_>,
    l: &WorkspaceLocation,
) -> rusqlite::Result<()> {
    tx.execute(&format!("INSERT INTO workspace_locations({WORKSPACE_LOCATION_COLUMNS}) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"), params![l.id,l.workspace_id,l.project_location_id,l.location_name,l.source_path,l.access_mode,l.git_status,l.worktree_id,l.checkout_path,l.branch,l.base_branch,l.start_commit,l.forked_from_commit,l.remote_name,l.remote_branch,l.branch_ownership,l.delivery_mode,l.delivery_status,l.close_outcome,l.integrated_commit,l.closed_at,l.created_at,l.updated_at])?;
    Ok(())
}
const SESSION_COLUMNS: &str = "id,workspace_id,name,kind,cwd,original_cwd,initial_prompt,codex_session_id,yolo,sidebar_visible,hidden_at,evicted_at,process_id,process_name,status,pid,process_group_id,exit_code,exit_signal,command,launch_started_at,last_attached_at,created_at,updated_at";
fn session_row(r: &Row<'_>) -> rusqlite::Result<Session> {
    let command: String = r.get(19)?;
    Ok(Session {
        id: r.get(0)?,
        workspace_id: r.get(1)?,
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
        workspace_id: r.get(1)?,
        title: r.get(2)?,
        description: r.get(3)?,
        status: r.get(4)?,
        session_id: r.get(5)?,
        blocked_reason: r.get(6)?,
        created_at: r.get(7)?,
        updated_at: r.get(8)?,
    })
}

const TODO_COLUMNS: &str =
    "id,workspace_id,title,description,status,session_id,blocked_reason,created_at,updated_at";

const SETTLEMENT_OPERATION_COLUMNS: &str = "workspace_location_id,phase,code_action,todo_action,push_after_merge,keep_session_history,delete_worktree,delete_branch,commit_message,before_head,source_head,target_head,integrated_commit,error,started_at,updated_at";

fn delivery_operation_row(r: &Row<'_>) -> rusqlite::Result<DeliveryOperation> {
    Ok(DeliveryOperation {
        workspace_location_id: r.get(0)?,
        workspace_id: r.get(0)?,
        phase: r.get(1)?,
        code_action: r.get(2)?,
        todo_action: r.get(3)?,
        push_after_merge: r.get(4)?,
        keep_session_history: r.get(5)?,
        delete_worktree: r.get(6)?,
        delete_branch: r.get(7)?,
        commit_message: r.get(8)?,
        before_head: r.get(9)?,
        source_head: r.get(10)?,
        target_head: r.get(11)?,
        integrated_commit: r.get(12)?,
        error: r.get(13)?,
        started_at: r.get(14)?,
        updated_at: r.get(15)?,
    })
}

const REBASE_OPERATION_COLUMNS: &str = "id,workspace_location_id,status,phase,before_head,target_head,rebased_head,recovery_ref,error,started_at,updated_at,completed_at";

fn rebase_operation_row(r: &Row<'_>) -> rusqlite::Result<RebaseOperation> {
    Ok(RebaseOperation {
        id: r.get(0)?,
        workspace_location_id: r.get(1)?,
        workspace_id: r.get(1)?,
        status: r.get(2)?,
        phase: r.get(3)?,
        before_head: r.get(4)?,
        target_head: r.get(5)?,
        rebased_head: r.get(6)?,
        recovery_ref: r.get(7)?,
        error: r.get(8)?,
        started_at: r.get(9)?,
        updated_at: r.get(10)?,
        completed_at: r.get(11)?,
    })
}

const RESET_OPERATION_COLUMNS: &str = "id,workspace_location_id,status,mode,before_head,target_head,result_head,recovery_ref,error,started_at,updated_at,completed_at";

fn reset_operation_row(r: &Row<'_>) -> rusqlite::Result<ResetOperation> {
    Ok(ResetOperation {
        id: r.get(0)?,
        workspace_location_id: r.get(1)?,
        workspace_id: r.get(1)?,
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

fn delivery_preflight_row(r: &Row<'_>) -> rusqlite::Result<DeliveryPreflight> {
    Ok(DeliveryPreflight {
        id: r.get(0)?,
        workspace_location_id: r.get(1)?,
        workspace_id: r.get(1)?,
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

fn migrate_development_schema(connection: &Connection, path: &Path) -> Result<()> {
    let exists: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='projects')",
        [],
        |row| row.get(0),
    )?;
    if !exists {
        return Ok(());
    }
    let current = table_has_column(connection, "projects", "default_location_id")?
        && table_exists(connection, "project_locations")?
        && table_exists(connection, "workspace_locations")?;
    if current {
        if !table_has_column(connection, "project_locations", "delivery_mode")? {
            connection.execute(
                "ALTER TABLE project_locations ADD COLUMN delivery_mode TEXT",
                [],
            )?;
            connection.execute(
                "UPDATE project_locations SET delivery_mode='remote_review' WHERE git_common_dir IS NOT NULL",
                [],
            )?;
        }
        return Ok(());
    }

    // Project Locations deliberately starts a new business-data generation. User
    // preferences live in TOML and are not part of this database. Keep a complete,
    // versioned SQLite backup before clearing the old Project/Workspace records.
    let backup = path.with_extension("pre-project-locations-v1.db");
    if !backup.exists() {
        let quoted = backup.to_string_lossy().replace('\'', "''");
        connection.execute_batch(&format!("VACUUM INTO '{quoted}';"))?;
    }
    connection.execute_batch(
        "PRAGMA foreign_keys=OFF;
         DROP TABLE IF EXISTS session_additional_directories;
         DROP TABLE IF EXISTS session_context_paths;
         DROP TABLE IF EXISTS todos;
         DROP TABLE IF EXISTS delivery_preflights;
         DROP TABLE IF EXISTS settlement_preflights;
         DROP TABLE IF EXISTS delivery_operations;
         DROP TABLE IF EXISTS settlement_operations;
         DROP TABLE IF EXISTS rebase_operations;
         DROP TABLE IF EXISTS reset_operations;
         DROP TABLE IF EXISTS sessions;
         DROP TABLE IF EXISTS workspaces;
         DROP TABLE IF EXISTS workstreams;
         DROP TABLE IF EXISTS workspace_contexts;
         DROP TABLE IF EXISTS workstream_contexts;
         DROP TABLE IF EXISTS project_contexts;
         DROP TABLE IF EXISTS project_directories;
         DROP TABLE IF EXISTS workspace_locations;
         DROP TABLE IF EXISTS project_locations;
         DROP TABLE IF EXISTS projects;
         PRAGMA foreign_keys=ON;",
    )?;
    Ok(())
}

fn table_exists(connection: &Connection, table: &str) -> Result<bool> {
    Ok(connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?)",
        [table],
        |row| row.get(0),
    )?)
}

fn table_has_column(connection: &Connection, table: &str, column: &str) -> Result<bool> {
    let mut stmt = connection.prepare(&format!("PRAGMA table_info({table})"))?;
    let names = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(names.iter().any(|name| name == column))
}

#[cfg(test)]
mod workspace_schema_tests {
    use super::{table_exists, table_has_column, Connection, Store};

    fn temporary_database(name: &str) -> (std::path::PathBuf, std::path::PathBuf) {
        let root =
            std::env::temp_dir().join(format!("treefold-{name}-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&root).expect("create temporary database root");
        let path = root.join("treefold.db");
        (root, path)
    }

    #[test]
    fn current_schema_separates_projects_workspaces_and_locations() {
        let (root, path) = temporary_database("workspace-schema");
        let store = Store::open(&path).expect("open current Store");
        let connection = Connection::open(&path).expect("inspect current Store");
        assert!(table_has_column(&connection, "projects", "default_location_id").unwrap());
        assert!(!table_has_column(&connection, "projects", "primary_directory_id").unwrap());
        assert!(table_has_column(&connection, "workspaces", "kind").unwrap());
        assert!(table_has_column(&connection, "workspaces", "parent_workspace_id").unwrap());
        assert!(!table_has_column(&connection, "workspaces", "checkout_path").unwrap());
        assert!(table_exists(&connection, "project_locations").unwrap());
        assert!(table_has_column(&connection, "project_locations", "delivery_mode").unwrap());
        assert!(table_exists(&connection, "workspace_locations").unwrap());
        assert!(
            table_has_column(&connection, "delivery_operations", "workspace_location_id").unwrap()
        );
        drop(connection);
        drop(store);
        std::fs::remove_dir_all(root).expect("remove temporary database root");
    }

    #[test]
    fn adds_location_delivery_mode_without_clearing_current_business_data() {
        let (root, path) = temporary_database("location-delivery-mode-migration");
        let connection = Connection::open(&path).expect("create current database");
        connection
            .execute_batch(
                "CREATE TABLE projects (
                   id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
                   status TEXT NOT NULL DEFAULT 'active', default_location_id TEXT,
                   default_base_branch TEXT NOT NULL DEFAULT 'main',
                   default_delivery_mode TEXT NOT NULL DEFAULT 'remote_review',
                   created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                 );
                 CREATE TABLE project_locations (
                   id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL,
                   description TEXT NOT NULL DEFAULT '', worktree_setup_command TEXT NOT NULL DEFAULT '',
                   path TEXT NOT NULL, repository_url TEXT, preferred_remote_name TEXT,
                   base_branch TEXT, git_common_dir TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                 );
                 CREATE TABLE workspace_locations (id TEXT PRIMARY KEY, workspace_id TEXT);
                 INSERT INTO projects VALUES('p','Project','','active','l','main','remote_review','now','now');
                 INSERT INTO project_locations VALUES(
                   'l','p','repo','','','/repo',NULL,NULL,'main','/repo/.git','now','now'
                 );",
            )
            .expect("seed current database without location delivery mode");
        drop(connection);

        let store = Store::open(&path).expect("upgrade current database");
        let location = store.directory("l").expect("preserve location");
        assert_eq!(location.delivery_mode.as_deref(), Some("remote_review"));
        assert_eq!(location.name, "repo");
        drop(store);
        std::fs::remove_dir_all(root).expect("remove temporary database root");
    }

    #[test]
    fn legacy_database_is_backed_up_before_the_new_schema_is_created() {
        let (root, path) = temporary_database("workspace-migration");
        let connection = Connection::open(&path).expect("create legacy database");
        connection
            .execute_batch("CREATE TABLE projects(id TEXT PRIMARY KEY);")
            .expect("create legacy schema");
        drop(connection);

        let store = Store::open(&path).expect("migrate legacy database");
        assert!(path.with_extension("pre-project-locations-v1.db").exists());
        assert!(store.projects().expect("list migrated Projects").is_empty());
        drop(store);
        std::fs::remove_dir_all(root).expect("remove temporary database root");
    }

    #[test]
    fn previous_workspace_schema_is_backed_up_and_business_records_are_cleared() {
        let (root, path) = temporary_database("flat-workspace-migration");
        let connection = Connection::open(&path).expect("create flat Workspace database");
        connection.execute_batch(
            "CREATE TABLE projects (
               id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL,
               primary_directory_id TEXT NOT NULL, git_common_dir TEXT NOT NULL, preferred_remote TEXT,
               default_target_branch TEXT NOT NULL, default_delivery_mode TEXT NOT NULL,
               created_at TEXT NOT NULL, updated_at TEXT NOT NULL
             );
             CREATE TABLE workspaces (
               id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL,
               status TEXT NOT NULL, project_directory_id TEXT NOT NULL, worktree_id TEXT,
               checkout_path TEXT NOT NULL, target_branch TEXT NOT NULL, start_commit TEXT NOT NULL,
               branch TEXT NOT NULL, remote_name TEXT, remote_branch TEXT, branch_ownership TEXT NOT NULL,
               delivery_mode TEXT NOT NULL, delivery_status TEXT NOT NULL, close_outcome TEXT,
               integrated_commit TEXT, closed_at TEXT, runtime_id TEXT NOT NULL, runtime_name TEXT NOT NULL,
               created_at TEXT NOT NULL, updated_at TEXT NOT NULL
             );
             CREATE TABLE sessions (workspace_id TEXT NOT NULL);
             INSERT INTO projects VALUES(
               'p','Project','','active','d','/repo/.git','origin','main','remote_review','now','now'
             );
             INSERT INTO workspaces VALUES(
               'w','p','Feature','','active','d',NULL,'/worktree','main','abc','treefold/feature',
               'origin','feature/test','managed','remote_review','active',NULL,NULL,NULL,'w','treefold-w','now','now'
             );",
        ).expect("seed flat Workspace schema");
        drop(connection);

        let store = Store::open(&path).expect("upgrade flat Workspace database");
        assert!(store.projects().expect("list Projects").is_empty());
        assert!(store.workspace("w").is_err());
        assert!(path.with_extension("pre-project-locations-v1.db").exists());
        drop(store);
        std::fs::remove_dir_all(root).expect("remove temporary database root");
    }
}

#[cfg(any())]
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
    fn removes_legacy_context_schema_without_losing_delivery_history() {
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
                 ALTER TABLE delivery_preflights
                   ADD COLUMN verification_command TEXT NOT NULL DEFAULT '[]';
                 ALTER TABLE delivery_preflights
                   ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'not_run';
                 ALTER TABLE delivery_preflights
                   ADD COLUMN verification_output TEXT NOT NULL DEFAULT '';
                 CREATE TABLE project_contexts (
                   id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
                   key TEXT NOT NULL, value TEXT NOT NULL,
                   created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                 );
                 CREATE TABLE workspace_contexts (
                   id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL,
                   key TEXT NOT NULL, value TEXT NOT NULL,
                   created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                 );
                 CREATE TABLE session_context_paths (
                   session_id TEXT NOT NULL, path TEXT NOT NULL,
                   PRIMARY KEY(session_id,path)
                 );
                 ALTER TABLE delivery_operations
                   ADD COLUMN context_action TEXT NOT NULL DEFAULT 'carry';
                 INSERT INTO projects VALUES(
                   'project-1','Project','', 'active','directory-1','main','now','now'
                 );
                 INSERT INTO project_directories VALUES(
                   'directory-1','project-1','repo','','/tmp/repo','primary',1,'now'
                 );
                 INSERT INTO workspaces VALUES(
                   'workspace-1','project-1','Work','', 'active','workspace',NULL,
                   'managed_worktree','directory-1',NULL,'/tmp/worktree','main','head',
                   'treefold/work',NULL,'none',NULL,NULL,NULL,'','','now','now'
                 );
                 INSERT INTO sessions(
                   id,workspace_id,name,kind,cwd,original_cwd,initial_prompt,yolo,
                   sidebar_visible,process_id,process_name,status,pid,process_group_id,
                   exit_signal,command,launch_started_at,created_at,updated_at
                 ) VALUES(
                   'session-1','workspace-1','Codex','codex','/tmp/worktree',
                   '/tmp/worktree','',0,1,'','','closed',0,0,'','[]','now','now','now'
                 );
                 INSERT INTO session_context_paths VALUES('session-1','/tmp/legacy-attached');
                 INSERT INTO delivery_operations(
                   workspace_id,phase,code_action,todo_action,keep_session_history,
                   delete_worktree,delete_branch,commit_message,before_head,source_head,
                   target_head,integrated_commit,error,started_at,updated_at,context_action
                 ) VALUES(
                   'workspace-1','code_integrated','merge','carry',1,1,1,'','before',
                   'source','target',NULL,'','now','now','carry'
                 );",
            )
            .expect("seed legacy context schema");
        drop(connection);

        let store = Store::open(&path).expect("migrate legacy database");
        let db = store.0.lock();
        for table in [
            "project_contexts",
            "workspace_contexts",
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
            .prepare("PRAGMA table_info(delivery_operations)")
            .expect("inspect delivery schema")
            .query_map([], |row| row.get::<_, String>(1))
            .expect("read delivery columns")
            .collect::<rusqlite::Result<Vec<_>>>()
            .expect("collect delivery columns");
        assert!(!columns.iter().any(|name| name == "context_action"));
        let preflight_columns = db
            .prepare("PRAGMA table_info(delivery_preflights)")
            .expect("inspect delivery preflight schema")
            .query_map([], |row| row.get::<_, String>(1))
            .expect("read delivery preflight columns")
            .collect::<rusqlite::Result<Vec<_>>>()
            .expect("collect delivery preflight columns");
        for removed in [
            "verification_command",
            "verification_status",
            "verification_output",
        ] {
            assert!(!preflight_columns.iter().any(|name| name == removed));
        }
        let operation_count: i64 = db
            .query_row("SELECT COUNT(*) FROM delivery_operations", [], |row| {
                row.get(0)
            })
            .expect("count delivery history");
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
