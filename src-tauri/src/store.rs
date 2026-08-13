use std::{path::Path, sync::Arc};

use parking_lot::Mutex;
use rusqlite::Connection;

use crate::error::Result;

mod operations;
mod projects;
mod sessions;
mod todos;
mod workspaces;

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
 codex_session_id TEXT, sidebar_visible INTEGER NOT NULL DEFAULT 1,
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
}

pub fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn migrate_development_schema(connection: &Connection, path: &Path) -> Result<()> {
    let exists: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='projects') AS table_exists",
        [],
        |row| row.get("table_exists"),
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
        if table_exists(connection, "sessions")?
            && table_has_column(connection, "sessions", "yolo")?
        {
            connection.execute("ALTER TABLE sessions DROP COLUMN yolo", [])?;
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
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?) AS table_exists",
        [table],
        |row| row.get("table_exists"),
    )?)
}

fn table_has_column(connection: &Connection, table: &str, column: &str) -> Result<bool> {
    let mut stmt = connection.prepare(&format!("PRAGMA table_info({table})"))?;
    let names = stmt
        .query_map([], |row| row.get::<_, String>("name"))?
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
        assert!(!table_has_column(&connection, "sessions", "yolo").unwrap());
        assert!(
            table_has_column(&connection, "delivery_operations", "workspace_location_id").unwrap()
        );
        drop(connection);
        drop(store);
        std::fs::remove_dir_all(root).expect("remove temporary database root");
    }

    #[test]
    fn removes_session_launch_mode_column_without_losing_session_history() {
        let (root, path) = temporary_database("session-launch-mode-migration");
        let store = Store::open(&path).expect("create current database");
        drop(store);

        let connection = Connection::open(&path).expect("open current database");
        connection
            .execute_batch(
                "PRAGMA foreign_keys=OFF;
                 ALTER TABLE sessions ADD COLUMN yolo INTEGER NOT NULL DEFAULT 0;
                 INSERT INTO sessions(
                   id,workspace_id,name,kind,cwd,original_cwd,status,
                   launch_started_at,created_at,updated_at,yolo
                 ) VALUES(
                   'session-1','workspace-1','Saved Codex','codex','/tmp/worktree',
                   '/tmp/worktree','closed','now','now','now',1
                 );
                 PRAGMA foreign_keys=ON;",
            )
            .expect("seed legacy Session launch mode");
        drop(connection);

        let store = Store::open(&path).expect("migrate current database");
        let connection = Connection::open(&path).expect("inspect migrated database");
        assert!(!table_has_column(&connection, "sessions", "yolo").unwrap());
        assert_eq!(
            store.session("session-1").expect("preserve Session").name,
            "Saved Codex"
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
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='settings') AS table_exists",
                [],
                |row| row.get("table_exists"),
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
                   id,workspace_id,name,kind,cwd,original_cwd,initial_prompt,
                   sidebar_visible,process_id,process_name,status,pid,process_group_id,
                   exit_signal,command,launch_started_at,created_at,updated_at
                 ) VALUES(
                   'session-1','workspace-1','Codex','codex','/tmp/worktree',
                   '/tmp/worktree','',1,'','','closed',0,0,'','[]','now','now','now'
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
                    "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?) AS table_exists",
                    [table],
                    |row| row.get("table_exists"),
                )
                .expect("inspect migrated tables");
            assert!(!exists, "{table} should be removed");
        }
        let columns = db
            .prepare("PRAGMA table_info(delivery_operations)")
            .expect("inspect delivery schema")
            .query_map([], |row| row.get::<_, String>("name"))
            .expect("read delivery columns")
            .collect::<rusqlite::Result<Vec<_>>>()
            .expect("collect delivery columns");
        assert!(!columns.iter().any(|name| name == "context_action"));
        let preflight_columns = db
            .prepare("PRAGMA table_info(delivery_preflights)")
            .expect("inspect delivery preflight schema")
            .query_map([], |row| row.get::<_, String>("name"))
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
            .query_row(
                "SELECT COUNT(*) AS count FROM delivery_operations",
                [],
                |row| row.get("count"),
            )
            .expect("count delivery history");
        assert_eq!(operation_count, 1);
        let foreign_key_violations: i64 = db
            .query_row(
                "SELECT COUNT(*) AS count FROM pragma_foreign_key_check",
                [],
                |row| row.get("count"),
            )
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
