use std::path::Path;

use anyhow::{Context, bail};
use rusqlite::{Connection, Transaction};
use rusqlite_migration::{HookResult, M, Migrations, SchemaVersion};

fn migrations() -> Migrations<'static> {
    Migrations::new(vec![
        M::up(include_str!("../migrations/0001_initial.sql")),
        M::up(include_str!(
            "../migrations/0002_nullable_repository_delivery.sql"
        )),
        // The preceding migrations briefly contained this column during pre-release
        // development. Keep the forward migration compatible with databases created
        // in that window while older version-2 databases receive the column normally.
        M::up_with_hook("", add_project_repository_source_ownership),
    ])
}

fn add_project_repository_source_ownership(transaction: &Transaction<'_>) -> HookResult {
    let already_exists = transaction
        .prepare("PRAGMA table_info(project_repositories)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<rusqlite::Result<Vec<_>>>()?
        .iter()
        .any(|column| column == "source_ownership");
    if !already_exists {
        transaction.execute_batch(include_str!(
            "../migrations/0003_project_repository_source_ownership.sql"
        ))?;
    }
    Ok(())
}

pub(super) fn to_latest(connection: &mut Connection, path: &Path) -> anyhow::Result<()> {
    let migrations = migrations();
    let version = migrations
        .current_version(connection)
        .context("read SQLite schema version")?;

    match version {
        SchemaVersion::NoneSet if has_tables(connection)? => {
            bail!(
                "database {} has no migration version but contains application tables. \
                 Close Treefold, then delete treefold.db, treefold.db-wal, and treefold.db-shm \
                 before restarting",
                path.display()
            );
        }
        SchemaVersion::Outside(version) => {
            bail!(
                "database {} has schema version {version}, which is newer than this Treefold build supports",
                path.display()
            );
        }
        _ => {}
    }

    connection
        .execute_batch("PRAGMA foreign_keys=OFF;")
        .context("disable SQLite foreign keys for schema migrations")?;
    let migration_result = migrations
        .to_latest(connection)
        .context("apply SQLite schema migrations");
    connection
        .execute_batch("PRAGMA foreign_keys=ON;")
        .context("restore SQLite foreign keys after schema migrations")?;
    migration_result?;
    let foreign_key_violation: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_foreign_key_check)",
            [],
            |row| row.get(0),
        )
        .context("validate SQLite foreign keys after schema migrations")?;
    if foreign_key_violation {
        bail!("SQLite migration left invalid foreign key references");
    }
    Ok(())
}

fn has_tables(connection: &Connection) -> anyhow::Result<bool> {
    connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM sqlite_master
                WHERE type='table' AND name NOT LIKE 'sqlite_%'
            )",
            [],
            |row| row.get(0),
        )
        .context("inspect unversioned SQLite database")
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::super::Store;

    fn user_version(connection: &Connection) -> i64 {
        connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("read user_version")
    }

    fn schema_objects(connection: &Connection) -> Vec<(String, String, String)> {
        connection
            .prepare(
                "SELECT type,name,sql FROM sqlite_master
                 WHERE name NOT LIKE 'sqlite_%'
                 ORDER BY type,name",
            )
            .expect("prepare schema query")
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .expect("read schema")
            .collect::<rusqlite::Result<_>>()
            .expect("collect schema")
    }

    #[test]
    fn empty_database_migrates_to_complete_schema() {
        let directory = tempfile::tempdir().expect("create temporary directory");
        let path = directory.path().join("treefold.db");
        let store = Store::open(&path).expect("migrate empty database");
        let database = store.0.lock();

        assert_eq!(user_version(&database), 3);
        let objects = schema_objects(&database);
        assert_eq!(objects.len(), 23, "unexpected schema objects: {objects:#?}");
        for table in [
            "projects",
            "project_repositories",
            "project_directories",
            "workspaces",
            "workspace_repositories",
            "workspace_directories",
            "sessions",
            "session_additional_directories",
            "todos",
            "delivery_operations",
            "parent_operations",
            "delivery_preflights",
        ] {
            assert!(
                objects
                    .iter()
                    .any(|(kind, name, _)| kind == "table" && name == table),
                "missing table {table}"
            );
        }
        for index in [
            "workspace_repositories_workspace",
            "workspace_directories_workspace",
            "workspaces_project_status_kind_parent",
            "sessions_workspace_visible_order",
            "sessions_amux_identity",
            "todos_fork",
            "parent_operations_repository_updated",
            "parent_operations_target_updated",
            "delivery_preflights_repository_created",
        ] {
            assert!(
                objects
                    .iter()
                    .any(|(kind, name, _)| kind == "index" && name == index),
                "missing index {index}"
            );
        }
        for trigger in [
            "projects_default_directory_insert",
            "projects_default_directory_update",
        ] {
            assert!(
                objects
                    .iter()
                    .any(|(kind, name, _)| kind == "trigger" && name == trigger),
                "missing trigger {trigger}"
            );
        }
        for (table, expected) in [
            ("projects", 0),
            ("project_repositories", 1),
            ("project_directories", 2),
            ("workspaces", 2),
            ("workspace_repositories", 2),
            ("workspace_directories", 3),
            ("sessions", 1),
            ("session_additional_directories", 1),
            ("todos", 2),
            ("delivery_operations", 1),
            ("parent_operations", 2),
            ("delivery_preflights", 1),
        ] {
            let foreign_keys = database
                .prepare(&format!("PRAGMA foreign_key_list({table})"))
                .expect("prepare foreign key query")
                .query_map([], |_| Ok(()))
                .expect("read foreign keys")
                .count();
            assert_eq!(
                foreign_keys, expected,
                "unexpected foreign keys for {table}"
            );
        }
        assert_eq!(
            database
                .query_row("PRAGMA foreign_keys", [], |row| row.get::<_, i64>(0))
                .expect("read foreign_keys"),
            1
        );
    }

    #[test]
    fn reopening_current_database_preserves_schema_and_data() {
        let directory = tempfile::tempdir().expect("create temporary directory");
        let path = directory.path().join("treefold.db");
        let store = Store::open(&path).expect("create database");
        store
            .0
            .lock()
            .execute(
                "INSERT INTO projects(id,name,created_at,updated_at) VALUES('p','Project','now','now')",
                [],
            )
            .expect("seed project");
        let original_schema = schema_objects(&store.0.lock());
        drop(store);

        let reopened = Store::open(&path).expect("reopen current database");
        let database = reopened.0.lock();
        assert_eq!(user_version(&database), 3);
        assert_eq!(schema_objects(&database), original_schema);
        assert_eq!(
            database
                .query_row("SELECT name FROM projects WHERE id='p'", [], |row| {
                    row.get::<_, String>(0)
                })
                .expect("read preserved project"),
            "Project"
        );
    }

    #[test]
    fn v1_repository_delivery_schema_migrates_without_data_loss() {
        let directory = tempfile::tempdir().expect("create temporary directory");
        let path = directory.path().join("treefold.db");
        let mut v1 = include_str!("../migrations/0001_initial.sql").replace(
            "base_branch TEXT, delivery_mode TEXT,",
            "base_branch TEXT NOT NULL DEFAULT 'main', delivery_mode TEXT NOT NULL DEFAULT 'push_branch',",
        );
        v1.push_str(
            "\nPRAGMA user_version=1;\n\
             INSERT INTO projects(id,name,created_at,updated_at) VALUES('p','Project','now','now');\n\
             INSERT INTO project_repositories(\n\
               id,project_id,name,source_root,git_common_dir,created_at,updated_at\n\
             ) VALUES('r','p','Repo','/tmp/repo','/tmp/repo/.git','now','now');\n\
             INSERT INTO project_directories(\n\
               id,project_id,repository_id,name,relative_path,created_at,updated_at\n\
             ) VALUES('d','p','r','Repo','.','now','now');\n\
             INSERT INTO workspaces(\n\
               id,project_id,name,status,created_at,updated_at\n\
             ) VALUES('w','p','Workspace','active','now','now');\n\
             INSERT INTO workspace_repositories(\n\
               id,workspace_id,project_repository_id,repository_name,source_root,git_status,created_at,updated_at\n\
             ) VALUES('wr','w','r','Repo','/tmp/repo','ready','now','now');",
        );
        let connection = Connection::open(&path).expect("open old database");
        connection.execute_batch(&v1).expect("create v1 database");
        drop(connection);

        let store = Store::open(&path).expect("migrate v1 database");
        let database = store.0.lock();
        assert_eq!(user_version(&database), 3);
        let nullable = database
            .prepare("PRAGMA table_info(project_repositories)")
            .unwrap()
            .query_map([], |row| {
                Ok((row.get::<_, String>(1)?, row.get::<_, i64>(3)?))
            })
            .unwrap()
            .collect::<rusqlite::Result<std::collections::HashMap<_, _>>>()
            .unwrap();
        assert_eq!(nullable.get("base_branch"), Some(&0));
        assert_eq!(nullable.get("delivery_mode"), Some(&0));
        assert_eq!(nullable.get("source_ownership"), Some(&1));
        for table in [
            "project_repositories",
            "project_directories",
            "workspace_repositories",
        ] {
            assert_eq!(
                database
                    .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                        row.get::<_, i64>(0)
                    })
                    .unwrap(),
                1,
                "preserve {table} rows"
            );
        }
    }

    #[test]
    fn v2_database_adds_source_ownership_without_data_loss() {
        let directory = tempfile::tempdir().expect("create temporary directory");
        let path = directory.path().join("treefold.db");
        let database = Connection::open(&path).expect("open v2 database");
        database
            .execute_batch(include_str!("../migrations/0001_initial.sql"))
            .expect("create v1 schema");
        database
            .execute(
                "INSERT INTO projects(id,name,created_at,updated_at) VALUES('p','Project','now','now')",
                [],
            )
            .expect("seed project");
        database
            .execute(
                "INSERT INTO project_repositories(id,project_id,name,source_root,git_common_dir,created_at,updated_at)
                 VALUES('r','p','Repo','/tmp/repo','/tmp/repo/.git','now','now')",
                [],
            )
            .expect("seed repository");
        database
            .execute_batch(include_str!(
                "../migrations/0002_nullable_repository_delivery.sql"
            ))
            .expect("migrate to v2 schema");
        database
            .execute_batch("PRAGMA user_version=2;")
            .expect("mark v2 schema");
        drop(database);

        let store = Store::open(&path).expect("migrate v2 database");
        let database = store.0.lock();
        assert_eq!(user_version(&database), 3);
        assert_eq!(
            database
                .query_row(
                    "SELECT source_ownership FROM project_repositories WHERE id='r'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .expect("read migrated ownership"),
            "external"
        );
    }

    #[test]
    fn transitional_v2_database_preserves_existing_source_ownership() {
        let directory = tempfile::tempdir().expect("create temporary directory");
        let path = directory.path().join("treefold.db");
        let database = Connection::open(&path).expect("open transitional database");
        database
            .execute_batch(include_str!("../migrations/0001_initial.sql"))
            .expect("create v1 schema");
        database
            .execute_batch(include_str!(
                "../migrations/0002_nullable_repository_delivery.sql"
            ))
            .expect("migrate to v2 schema");
        database
            .execute_batch(include_str!(
                "../migrations/0003_project_repository_source_ownership.sql"
            ))
            .expect("add transitional ownership column");
        database
            .execute(
                "INSERT INTO projects(id,name,created_at,updated_at) VALUES('p','Project','now','now')",
                [],
            )
            .expect("seed project");
        database
            .execute(
                "INSERT INTO project_repositories(
                   id,project_id,name,source_root,git_common_dir,source_ownership,created_at,updated_at
                 ) VALUES('r','p','Repo','/tmp/repo','/tmp/repo/.git','managed','now','now')",
                [],
            )
            .expect("seed managed repository");
        database
            .execute_batch("PRAGMA user_version=2;")
            .expect("mark transitional v2 schema");
        drop(database);

        let store = Store::open(&path).expect("migrate transitional database");
        let database = store.0.lock();
        assert_eq!(user_version(&database), 3);
        assert_eq!(
            database
                .query_row(
                    "SELECT source_ownership FROM project_repositories WHERE id='r'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .expect("read preserved ownership"),
            "managed"
        );
    }

    #[test]
    fn unversioned_database_with_tables_is_rejected_without_data_loss() {
        let directory = tempfile::tempdir().expect("create temporary directory");
        let path = directory.path().join("treefold.db");
        let database = Connection::open(&path).expect("create legacy database");
        database
            .execute_batch(
                "CREATE TABLE projects(id TEXT PRIMARY KEY, name TEXT NOT NULL);
                 INSERT INTO projects VALUES('legacy','Keep me');",
            )
            .expect("seed legacy database");
        let original_schema = schema_objects(&database);
        drop(database);

        let error = Store::open(&path)
            .err()
            .expect("unversioned database must be rejected");
        let message = error.to_string();
        assert!(message.contains("has no migration version"));
        assert!(message.contains("delete treefold.db, treefold.db-wal, and treefold.db-shm"));
        assert!(path.exists());
        assert!(!path.with_extension("pre-repository-scopes-v2.db").exists());
        assert!(!path.with_extension("pre-workspace-todos-v4.db").exists());

        let database = Connection::open(&path).expect("reopen rejected database");
        assert_eq!(user_version(&database), 0);
        assert_eq!(schema_objects(&database), original_schema);
        assert_eq!(
            database
                .query_row("SELECT name FROM projects WHERE id='legacy'", [], |row| {
                    row.get::<_, String>(0)
                })
                .expect("read preserved legacy row"),
            "Keep me"
        );
    }

    #[test]
    fn database_newer_than_supported_version_is_rejected() {
        let directory = tempfile::tempdir().expect("create temporary directory");
        let path = directory.path().join("treefold.db");
        let database = Connection::open(&path).expect("create future database");
        database
            .execute_batch("PRAGMA user_version=4;")
            .expect("set future version");
        drop(database);

        let error = Store::open(&path)
            .err()
            .expect("future database must be rejected");
        assert!(error.to_string().contains("schema version 4"));
        assert!(error.to_string().contains("newer than this Treefold build"));
    }
}
