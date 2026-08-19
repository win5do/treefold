use std::{path::Path, sync::Arc};

use async_sqlite::{Pool, PoolBuilder};
use parking_lot::Mutex;
use rusqlite::Connection;

use crate::error::Result;

mod operations;
mod projects;
mod sessions;
mod todos;
mod workspaces;

pub(crate) use operations::ParentOperationUpdate;

#[derive(Clone)]
pub struct Store(Arc<Mutex<Connection>>, Pool);

const SCHEMA: &str = r#"
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS projects (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'active',
 default_directory_id TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_repositories (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 name TEXT NOT NULL, source_root TEXT NOT NULL, git_common_dir TEXT NOT NULL,
 repository_url TEXT, preferred_remote_name TEXT,
 base_branch TEXT NOT NULL DEFAULT 'main', delivery_mode TEXT NOT NULL DEFAULT 'push_branch',
 setup_command TEXT NOT NULL DEFAULT '', setup_workdir TEXT NOT NULL DEFAULT '.',
 git_status TEXT NOT NULL DEFAULT 'ready', last_checked_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
 UNIQUE(project_id,git_common_dir)
);
CREATE TABLE IF NOT EXISTS project_directories (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 repository_id TEXT REFERENCES project_repositories(id),
 name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', relative_path TEXT, external_path TEXT,
 status TEXT NOT NULL DEFAULT 'ready', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
 CHECK((repository_id IS NOT NULL AND relative_path IS NOT NULL AND external_path IS NULL)
    OR (repository_id IS NULL AND relative_path IS NULL AND external_path IS NOT NULL)),
 UNIQUE(repository_id,relative_path), UNIQUE(project_id,external_path)
);
CREATE TABLE IF NOT EXISTS workspaces (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
 kind TEXT NOT NULL DEFAULT 'workspace', parent_workspace_id TEXT REFERENCES workspaces(id),
 runtime_id TEXT NOT NULL DEFAULT '', runtime_name TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workspace_repositories (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 project_repository_id TEXT NOT NULL REFERENCES project_repositories(id),
 repository_name TEXT NOT NULL, source_root TEXT NOT NULL,
 git_status TEXT NOT NULL, creation_error TEXT, worktree_id TEXT, checkout_path TEXT, branch TEXT,
 base_branch TEXT, start_commit TEXT, forked_from_commit TEXT,
 remote_name TEXT, remote_branch TEXT, branch_ownership TEXT NOT NULL DEFAULT 'managed',
 delivery_mode TEXT NOT NULL DEFAULT 'push_branch', delivery_status TEXT NOT NULL DEFAULT 'active',
 close_outcome TEXT, integrated_commit TEXT, closed_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(workspace_id,project_repository_id)
);
CREATE TABLE IF NOT EXISTS workspace_directories (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 project_directory_id TEXT NOT NULL REFERENCES project_directories(id),
 workspace_repository_id TEXT REFERENCES workspace_repositories(id) ON DELETE CASCADE,
 name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', relative_path TEXT, external_path TEXT,
 access_mode TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(workspace_id,project_directory_id)
);
CREATE INDEX IF NOT EXISTS workspace_repositories_workspace ON workspace_repositories(workspace_id);
CREATE INDEX IF NOT EXISTS workspace_directories_workspace ON workspace_directories(workspace_id);
CREATE INDEX IF NOT EXISTS workspaces_project_status_kind_parent
 ON workspaces(project_id,status,kind,parent_workspace_id);
CREATE TRIGGER IF NOT EXISTS projects_default_directory_insert
BEFORE INSERT ON projects WHEN NEW.default_directory_id IS NOT NULL
BEGIN SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM project_directories WHERE id=NEW.default_directory_id AND project_id=NEW.id AND repository_id IS NOT NULL AND status='ready' AND deleted_at IS NULL
) THEN RAISE(ABORT,'default directory must belong to an available Repository in this Project') END; END;
CREATE TRIGGER IF NOT EXISTS projects_default_directory_update
BEFORE UPDATE OF default_directory_id ON projects WHEN NEW.default_directory_id IS NOT NULL
BEGIN SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM project_directories WHERE id=NEW.default_directory_id AND project_id=NEW.id AND repository_id IS NOT NULL AND status='ready' AND deleted_at IS NULL
) THEN RAISE(ABORT,'default directory must belong to an available Repository in this Project') END; END;
CREATE TABLE IF NOT EXISTS sessions (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 name TEXT NOT NULL, kind TEXT NOT NULL, cwd TEXT NOT NULL, original_cwd TEXT NOT NULL,
 initial_prompt TEXT NOT NULL DEFAULT '',
 codex_session_id TEXT, visibility TEXT NOT NULL DEFAULT 'visible' CHECK(visibility IN ('visible','hidden')),
 hidden_at TEXT, evicted_at TEXT,
 amux_workspace_name TEXT NOT NULL DEFAULT '', amux_process_name TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL CHECK(status IN ('running','stopped','exited','failed')),
 exit_code INTEGER, exit_signal TEXT NOT NULL DEFAULT '',
 argv TEXT NOT NULL DEFAULT '[]', io_mode TEXT NOT NULL DEFAULT 'tty' CHECK(io_mode IN ('pipe','tty')),
 launch_started_at TEXT NOT NULL, last_attached_at TEXT,
 sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_workspace_visible_order
 ON sessions(workspace_id,visibility,sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS sessions_amux_identity
 ON sessions(amux_workspace_name,amux_process_name)
 WHERE amux_workspace_name!='' AND amux_process_name!='';
CREATE TABLE IF NOT EXISTS session_additional_directories (
 session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, path TEXT NOT NULL,
 access_mode TEXT NOT NULL DEFAULT 'read_write',
 PRIMARY KEY(session_id,path)
);
CREATE TABLE IF NOT EXISTS todos (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 content TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','in_progress','blocked','done')),
 fork_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL, blocked_reason TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS todos_fork ON todos(fork_id) WHERE fork_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS delivery_operations (
 workspace_repository_id TEXT PRIMARY KEY REFERENCES workspace_repositories(id) ON DELETE CASCADE,
 phase TEXT NOT NULL, code_action TEXT NOT NULL, todo_action TEXT NOT NULL DEFAULT 'keep',
 push_after_merge INTEGER NOT NULL DEFAULT 0,
 keep_session_history INTEGER NOT NULL,
 delete_worktree INTEGER NOT NULL, delete_branch INTEGER NOT NULL,
 commit_message TEXT NOT NULL DEFAULT '', before_head TEXT NOT NULL DEFAULT '',
 source_head TEXT NOT NULL DEFAULT '', target_head TEXT NOT NULL DEFAULT '',
 integrated_commit TEXT, error TEXT NOT NULL DEFAULT '',
 started_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS parent_operations (
 id TEXT PRIMARY KEY,
 workspace_repository_id TEXT NOT NULL REFERENCES workspace_repositories(id) ON DELETE CASCADE,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 direction TEXT NOT NULL CHECK(direction IN ('update','integrate')),
 strategy TEXT NOT NULL CHECK(strategy IN ('rebase','merge')),
 origin TEXT NOT NULL DEFAULT 'standalone' CHECK(origin IN ('standalone','finish','legacy')),
 source_repository_id TEXT NOT NULL,
 source_path TEXT NOT NULL, source_branch TEXT NOT NULL,
 target_scope TEXT NOT NULL, target_workspace_id TEXT,
 target_path TEXT NOT NULL, target_branch TEXT NOT NULL,
 source_head TEXT NOT NULL, parent_head TEXT NOT NULL, before_head TEXT NOT NULL,
 result_head TEXT, recovery_ref TEXT NOT NULL,
 status TEXT NOT NULL, phase TEXT NOT NULL,
 resolver_session_id TEXT, delivery_operation_id TEXT,
 undo_available INTEGER NOT NULL DEFAULT 0,
 error TEXT NOT NULL DEFAULT '', started_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 completed_at TEXT
);
CREATE INDEX IF NOT EXISTS parent_operations_repository_updated
 ON parent_operations(workspace_repository_id,direction,updated_at DESC);
CREATE INDEX IF NOT EXISTS parent_operations_target_updated
 ON parent_operations(source_repository_id,target_path,updated_at DESC);
CREATE TABLE IF NOT EXISTS delivery_preflights (
 id TEXT PRIMARY KEY, workspace_repository_id TEXT NOT NULL REFERENCES workspace_repositories(id) ON DELETE CASCADE,
 code_action TEXT NOT NULL, source_head TEXT NOT NULL, target_head TEXT NOT NULL,
 target_branch TEXT NOT NULL, source_status TEXT NOT NULL, source_dirty INTEGER NOT NULL,
 target_dirty INTEGER NOT NULL, ahead INTEGER NOT NULL, behind INTEGER NOT NULL,
 changed_files TEXT NOT NULL, commits TEXT NOT NULL, diff_stat TEXT NOT NULL,
 blockers TEXT NOT NULL, warnings TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS delivery_preflights_repository_created
 ON delivery_preflights(workspace_repository_id,created_at DESC);
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
        migrate_delivery_strategy(&connection)?;
        let readers = PoolBuilder::new()
            .path(path)
            .flags(rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .num_conns(2)
            .open_blocking()?;
        for result in readers.conn_for_each_blocking(|reader| {
            reader.busy_timeout(std::time::Duration::from_secs(5))?;
            reader.execute_batch("PRAGMA foreign_keys=ON; PRAGMA query_only=ON;")
        }) {
            result?;
        }
        Ok(Self(Arc::new(Mutex::new(connection)), readers))
    }
}

fn migrate_delivery_strategy(connection: &Connection) -> Result<()> {
    connection.execute(
        "UPDATE project_repositories SET delivery_mode='push_branch' WHERE delivery_mode='remote_review'",
        [],
    )?;
    connection.execute(
        "UPDATE workspace_repositories SET delivery_mode='push_branch' WHERE delivery_mode='remote_review'",
        [],
    )?;
    Ok(())
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
    let current = table_has_column(connection, "projects", "default_directory_id")?
        && table_exists(connection, "project_repositories")?
        && table_exists(connection, "project_directories")?
        && table_exists(connection, "workspace_repositories")?
        && table_exists(connection, "workspace_directories")?;
    if current {
        migrate_soft_delete_schema(connection)?;
        if table_exists(connection, "sessions")?
            && table_has_column(connection, "sessions", "yolo")?
        {
            connection.execute("ALTER TABLE sessions DROP COLUMN yolo", [])?;
        }
        if table_exists(connection, "sessions")?
            && !table_has_column(connection, "sessions", "sort_order")?
        {
            connection.execute(
                "ALTER TABLE sessions ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
                [],
            )?;
        }
        migrate_session_lifecycle_schema(connection)?;
        migrate_todo_v4_schema(connection, path)?;
        return Ok(());
    }

    // Project Locations deliberately starts a new business-data generation. User
    // preferences live in TOML and are not part of this database. Keep a complete,
    // versioned SQLite backup before clearing the old Project/Workspace records.
    let backup = path.with_extension("pre-repository-scopes-v2.db");
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
         DROP TABLE IF EXISTS workspace_directories;
         DROP TABLE IF EXISTS workspace_repositories;
         DROP TABLE IF EXISTS project_repositories;
         DROP TABLE IF EXISTS workspace_locations;
         DROP TABLE IF EXISTS project_locations;
         DROP TABLE IF EXISTS projects;
         PRAGMA foreign_keys=ON;",
    )?;
    Ok(())
}

fn migrate_todo_v4_schema(connection: &Connection, path: &Path) -> Result<()> {
    if !table_exists(connection, "todos")? || table_has_column(connection, "todos", "content")? {
        return Ok(());
    }
    let backup = path.with_extension("pre-workspace-todos-v4.db");
    if !backup.exists() {
        let quoted = backup.to_string_lossy().replace('\'', "''");
        connection.execute_batch(&format!("VACUUM INTO '{quoted}';"))?;
    }
    connection.execute_batch("DROP TABLE todos;")?;
    Ok(())
}

fn migrate_soft_delete_schema(connection: &Connection) -> Result<()> {
    if !table_has_column(connection, "project_repositories", "deleted_at")? {
        connection.execute(
            "ALTER TABLE project_repositories ADD COLUMN deleted_at TEXT",
            [],
        )?;
    }
    if !table_has_column(connection, "project_directories", "deleted_at")? {
        connection.execute(
            "ALTER TABLE project_directories ADD COLUMN deleted_at TEXT",
            [],
        )?;
    }
    // CREATE TRIGGER IF NOT EXISTS cannot update an existing trigger definition.
    connection.execute_batch(
        "DROP TRIGGER IF EXISTS projects_default_directory_insert;
         DROP TRIGGER IF EXISTS projects_default_directory_update;",
    )?;
    Ok(())
}

fn migrate_session_lifecycle_schema(connection: &Connection) -> Result<()> {
    if !table_exists(connection, "sessions")? {
        return Ok(());
    }
    if table_has_column(connection, "sessions", "sidebar_visible")? {
        connection.execute(
            "ALTER TABLE sessions RENAME COLUMN sidebar_visible TO visibility",
            [],
        )?;
        connection.execute(
            "UPDATE sessions SET visibility=CASE WHEN visibility=1 OR visibility='1' THEN 'visible' ELSE 'hidden' END",
            [],
        )?;
    }
    if !table_has_column(connection, "sessions", "amux_workspace_name")? {
        connection.execute(
            "ALTER TABLE sessions ADD COLUMN amux_workspace_name TEXT NOT NULL DEFAULT ''",
            [],
        )?;
    }
    if !table_has_column(connection, "sessions", "amux_process_name")? {
        connection.execute(
            "ALTER TABLE sessions ADD COLUMN amux_process_name TEXT NOT NULL DEFAULT ''",
            [],
        )?;
        if table_has_column(connection, "sessions", "process_name")? {
            connection.execute(
                "UPDATE sessions SET amux_process_name=CASE WHEN process_name!='' THEN process_name ELSE id END",
                [],
            )?;
        }
    }
    if !table_has_column(connection, "sessions", "argv")? {
        connection.execute(
            "ALTER TABLE sessions ADD COLUMN argv TEXT NOT NULL DEFAULT '[]'",
            [],
        )?;
        if table_has_column(connection, "sessions", "command")? {
            connection.execute("UPDATE sessions SET argv=command", [])?;
        }
    }
    if !table_has_column(connection, "sessions", "io_mode")? {
        connection.execute(
            "ALTER TABLE sessions ADD COLUMN io_mode TEXT NOT NULL DEFAULT 'tty'",
            [],
        )?;
    }
    connection.execute(
        "UPDATE sessions SET status=CASE WHEN status='running' THEN 'running' WHEN status='exited' THEN 'exited' WHEN status='failed' THEN 'failed' ELSE 'stopped' END",
        [],
    )?;
    // Existing Shell/Codex process names have always been their Session IDs. The
    // workspace name is filled lazily from cwd by the Store because SQLite has no
    // portable path hashing primitive.
    connection.execute(
        "UPDATE sessions SET amux_process_name=id WHERE amux_process_name=''",
        [],
    )?;
    let mut statement =
        connection.prepare("SELECT id,cwd FROM sessions WHERE amux_workspace_name=''")?;
    let sessions = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(statement);
    for (id, cwd) in sessions {
        connection.execute(
            "UPDATE sessions SET amux_workspace_name=? WHERE id=?",
            [stable_amux_workspace_name(&cwd), id],
        )?;
    }
    Ok(())
}

fn stable_amux_workspace_name(root_dir: &str) -> String {
    let normalized =
        std::fs::canonicalize(root_dir).unwrap_or_else(|_| std::path::PathBuf::from(root_dir));
    let mut hash = 0xcbf29ce484222325u64;
    for byte in normalized.to_string_lossy().as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("treefold-ws-{hash:016x}")
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
    use super::{Connection, Store, now, table_exists, table_has_column};
    use crate::model::{Directory, Project};

    fn temporary_database(name: &str) -> (std::path::PathBuf, std::path::PathBuf) {
        let root =
            std::env::temp_dir().join(format!("treefold-{name}-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&root).expect("create temporary database root");
        let path = root.join("treefold.db");
        (root, path)
    }

    #[test]
    fn current_schema_separates_repositories_and_directory_scopes() {
        let (root, path) = temporary_database("workspace-schema");
        let store = Store::open(&path).expect("open current Store");
        let connection = Connection::open(&path).expect("inspect current Store");
        assert!(table_has_column(&connection, "projects", "default_directory_id").unwrap());
        assert!(!table_has_column(&connection, "projects", "default_location_id").unwrap());
        for table in [
            "project_repositories",
            "project_directories",
            "workspace_repositories",
            "workspace_directories",
        ] {
            assert!(table_exists(&connection, table).unwrap(), "missing {table}");
        }
        assert!(!table_exists(&connection, "project_locations").unwrap());
        assert!(!table_exists(&connection, "workspace_locations").unwrap());
        assert!(
            table_has_column(
                &connection,
                "delivery_operations",
                "workspace_repository_id"
            )
            .unwrap()
        );
        assert!(table_has_column(&connection, "project_repositories", "setup_workdir").unwrap());
        assert!(table_has_column(&connection, "project_repositories", "deleted_at").unwrap());
        assert!(table_has_column(&connection, "project_directories", "deleted_at").unwrap());
        drop(connection);
        drop(store);
        std::fs::remove_dir_all(root).expect("remove temporary database root");
    }

    #[test]
    fn removed_non_git_directory_is_hidden_and_restored_with_original_id() {
        let (root, path) = temporary_database("soft-delete-directory");
        let store = Store::open(&path).expect("open Store");
        let timestamp = now();
        store
            .create_empty_project(&Project {
                id: "project".into(),
                name: "Project".into(),
                description: String::new(),
                status: "active".into(),
                default_location_id: None,
                default_base_branch: "main".into(),
                default_delivery_mode: "push_branch".into(),
                created_at: timestamp.clone(),
                updated_at: timestamp.clone(),
                primary_directory_id: String::new(),
                git_common_dir: String::new(),
                preferred_remote: None,
                default_target_branch: "main".into(),
            })
            .unwrap();
        let directory = |id: &str| Directory {
            id: id.into(),
            project_id: "project".into(),
            name: "Context".into(),
            description: String::new(),
            worktree_setup_command: String::new(),
            path: "/tmp/treefold-soft-delete-context".into(),
            repository_url: None,
            preferred_remote_name: None,
            base_branch: None,
            delivery_mode: None,
            git_common_dir: None,
            git_status: "not_git".into(),
            last_checked_at: None,
            created_at: timestamp.clone(),
            updated_at: timestamp.clone(),
            checkout_path: None,
            role: "attached".into(),
            is_git: false,
            remote_url: None,
            branch: None,
            head_commit: None,
            head_summary: None,
            dirty: false,
        };
        store.create_directory(&directory("original")).unwrap();
        store
            .update_directory("original", "Renamed", "Purpose", "", None, None)
            .unwrap();
        assert_eq!(store.directory("original").unwrap().name, "Renamed");
        store.delete_project_location("original").unwrap();
        assert!(store.directory("original").is_err());
        store.create_directory(&directory("replacement")).unwrap();
        assert_eq!(store.directories("project").unwrap()[0].id, "original");
        assert!(store.directory("replacement").is_err());
        drop(store);
        std::fs::remove_dir_all(root).unwrap();
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
                 DROP INDEX sessions_workspace_visible_order;
                 ALTER TABLE sessions DROP COLUMN sort_order;
                 ALTER TABLE sessions ADD COLUMN yolo INTEGER NOT NULL DEFAULT 0;
                 INSERT INTO sessions(
                   id,workspace_id,name,kind,cwd,original_cwd,status,
                   launch_started_at,created_at,updated_at,yolo
                 ) VALUES(
                   'session-1','workspace-1','Saved Codex','codex','/tmp/worktree',
                   '/tmp/worktree','stopped','now','now','now',1
                 );
                 PRAGMA foreign_keys=ON;",
            )
            .expect("seed legacy Session launch mode");
        drop(connection);

        let store = Store::open(&path).expect("migrate current database");
        let connection = Connection::open(&path).expect("inspect migrated database");
        assert!(!table_has_column(&connection, "sessions", "yolo").unwrap());
        assert!(table_has_column(&connection, "sessions", "sort_order").unwrap());
        assert_eq!(
            store.session("session-1").expect("preserve Session").name,
            "Saved Codex"
        );
        drop(connection);
        drop(store);
        std::fs::remove_dir_all(root).expect("remove temporary database root");
    }

    #[test]
    fn persists_session_order_within_workspace() {
        let (root, path) = temporary_database("session-order");
        let store = Store::open(&path).expect("create current database");
        let connection = Connection::open(&path).expect("seed Sessions");
        connection.execute_batch(
            "PRAGMA foreign_keys=ON;
             INSERT INTO projects(id,name,description,status,created_at,updated_at)
             VALUES('p','Project','','active','now','now');
             INSERT INTO workspaces(id,project_id,name,description,status,created_at,updated_at)
             VALUES('w','p','Workspace','','active','now','now');
             INSERT INTO sessions(id,workspace_id,name,kind,cwd,original_cwd,status,launch_started_at,created_at,updated_at)
             VALUES('s1','w','First','shell','/tmp','/tmp','running','now','2026-01-01','now');
             INSERT INTO sessions(id,workspace_id,name,kind,cwd,original_cwd,status,launch_started_at,created_at,updated_at)
             VALUES('s2','w','Second','codex','/tmp','/tmp','stopped','now','2026-01-02','now');",
        ).expect("seed Workspace Sessions");
        drop(connection);

        store
            .reorder_sessions("w", &["s1".into(), "s2".into()])
            .expect("persist Session order");
        assert_eq!(
            store
                .sessions("w")
                .expect("read ordered Sessions")
                .into_iter()
                .map(|session| session.id)
                .collect::<Vec<_>>(),
            vec!["s1", "s2"]
        );
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
        assert!(path.with_extension("pre-repository-scopes-v2.db").exists());
        assert!(store.projects().expect("list migrated Projects").is_empty());
        drop(store);
        std::fs::remove_dir_all(root).expect("remove temporary database root");
    }

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
