use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use sqlx::{
    ConnectOptions, SqlitePool,
    migrate::Migrator,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
};

use crate::error::{AppError, Result};

// These format strings interpolate only compile-time column-list constants.
macro_rules! static_sql {
    ($($token:tt)*) => { sqlx::AssertSqlSafe(format!($($token)*)) };
}

mod operations;
mod projects;
mod sessions;
mod todos;
mod workspaces;

pub(crate) use operations::ParentOperationUpdate;

pub const CURRENT_DATABASE_GENERATION: i64 = 1;
pub const CURRENT_DATABASE_FILENAME: &str = "treefold_1.sqlite";
static MIGRATOR: Migrator = sqlx::migrate!("./migrations/g1");

#[derive(Clone)]
pub struct Store {
    pub(super) pool: SqlitePool,
    database_path: Arc<PathBuf>,
}

impl Store {
    pub async fn open(data_dir: &Path) -> Result<Self> {
        std::fs::create_dir_all(data_dir).map_err(anyhow::Error::from)?;
        let database_path = data_dir.join(CURRENT_DATABASE_FILENAME);
        let existed = database_path.exists();
        let options = SqliteConnectOptions::new()
            .filename(&database_path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .foreign_keys(true)
            .busy_timeout(Duration::from_secs(5))
            .disable_statement_logging();
        let pool = SqlitePoolOptions::new()
            .max_connections(3)
            .connect_with(options)
            .await?;
        if existed {
            let generation: i64 = sqlx::query_scalar("PRAGMA user_version")
                .fetch_one(&pool)
                .await?;
            if generation != CURRENT_DATABASE_GENERATION {
                pool.close().await;
                return Err(AppError::Database(anyhow::anyhow!(
                    "database generation mismatch for {}: expected {}, found {}",
                    database_path.display(),
                    CURRENT_DATABASE_GENERATION,
                    generation
                )));
            }
        }
        MIGRATOR
            .run(&pool)
            .await
            .map_err(|error| AppError::Database(error.into()))?;
        let generation: i64 = sqlx::query_scalar("PRAGMA user_version")
            .fetch_one(&pool)
            .await?;
        if generation != CURRENT_DATABASE_GENERATION {
            return Err(AppError::Database(anyhow::anyhow!(
                "migration did not set database generation {}",
                CURRENT_DATABASE_GENERATION
            )));
        }
        let violations = sqlx::query("PRAGMA foreign_key_check")
            .fetch_all(&pool)
            .await?;
        if !violations.is_empty() {
            return Err(AppError::Database(anyhow::anyhow!(
                "database foreign key check found {} violation(s)",
                violations.len()
            )));
        }
        let store = Self {
            pool,
            database_path: Arc::new(database_path),
        };
        log::info!("opened SQLite database {}", store.database_path.display());
        Ok(store)
    }

    #[cfg(test)]
    pub fn database_path(&self) -> &Path {
        self.database_path.as_ref()
    }
}

pub fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests {
    use sqlx::{Connection, Executor, SqliteConnection, sqlite::SqliteConnectOptions};

    use super::{CURRENT_DATABASE_FILENAME, CURRENT_DATABASE_GENERATION, Store};
    use crate::{
        model::{Directory, Project},
        store::now,
    };

    #[tokio::test]
    async fn generation_one_database_is_created_and_reopens_with_data() {
        let directory = tempfile::tempdir().unwrap();
        let data = directory.path().join("data");
        let store = Store::open(&data).await.unwrap();

        assert_eq!(
            store.database_path(),
            data.join(CURRENT_DATABASE_FILENAME).as_path()
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("PRAGMA user_version")
                .fetch_one(&store.pool)
                .await
                .unwrap(),
            CURRENT_DATABASE_GENERATION
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM _sqlx_migrations WHERE success = 1")
                .fetch_one(&store.pool)
                .await
                .unwrap(),
            1
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM pragma_table_list WHERE schema='main' AND type='table' AND name NOT LIKE 'sqlite_%' AND name!='_sqlx_migrations' AND strict=0"
            )
            .fetch_one(&store.pool)
            .await
            .unwrap(),
            0,
            "every generation 1 domain table must be STRICT"
        );
        assert!(
            sqlx::query(
                "INSERT INTO projects(id,name,created_at,updated_at) VALUES('bad-type',?,'t','t')"
            )
            .bind(vec![0xff_u8])
            .execute(&store.pool)
            .await
            .is_err(),
            "STRICT tables must reject a BLOB written to a TEXT column"
        );
        sqlx::query("INSERT INTO projects(id,name,created_at,updated_at) VALUES('p','P','t','t')")
            .execute(&store.pool)
            .await
            .unwrap();
        store.pool.close().await;

        let reopened = Store::open(&data).await.unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT name FROM projects WHERE id='p'")
                .fetch_one(&reopened.pool)
                .await
                .unwrap(),
            "P"
        );
        reopened.pool.close().await;
    }

    #[tokio::test]
    async fn legacy_database_files_are_ignored_and_untouched() {
        let directory = tempfile::tempdir().unwrap();
        let data = directory.path().join("data");
        std::fs::create_dir_all(&data).unwrap();
        for name in ["treefold.db", "treefold.db-wal", "treefold.db-shm"] {
            std::fs::write(data.join(name), format!("legacy-{name}")).unwrap();
        }

        let store = Store::open(&data).await.unwrap();
        for name in ["treefold.db", "treefold.db-wal", "treefold.db-shm"] {
            assert_eq!(
                std::fs::read_to_string(data.join(name)).unwrap(),
                format!("legacy-{name}")
            );
        }
        store.pool.close().await;
    }

    #[tokio::test]
    async fn every_pool_connection_has_required_sqlite_pragmas() {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::open(directory.path()).await.unwrap();
        let mut first = store.pool.acquire().await.unwrap();
        let mut second = store.pool.acquire().await.unwrap();
        let mut third = store.pool.acquire().await.unwrap();

        for connection in [&mut first, &mut second, &mut third] {
            assert_eq!(
                sqlx::query_scalar::<_, String>("PRAGMA journal_mode")
                    .fetch_one(&mut **connection)
                    .await
                    .unwrap(),
                "wal"
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>("PRAGMA foreign_keys")
                    .fetch_one(&mut **connection)
                    .await
                    .unwrap(),
                1
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>("PRAGMA busy_timeout")
                    .fetch_one(&mut **connection)
                    .await
                    .unwrap(),
                5_000
            );
        }
        drop((first, second, third));
        assert!(
            sqlx::query("PRAGMA foreign_key_check")
                .fetch_all(&store.pool)
                .await
                .unwrap()
                .is_empty()
        );
        store.pool.close().await;
    }

    #[tokio::test]
    async fn existing_database_with_wrong_generation_is_rejected() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join(CURRENT_DATABASE_FILENAME);
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true);
        let mut connection = SqliteConnection::connect_with(&options).await.unwrap();
        connection.execute("PRAGMA user_version = 2").await.unwrap();
        connection.close().await.unwrap();

        let error = Store::open(directory.path()).await.err().unwrap();
        assert!(error.to_string().contains("expected 1, found 2"));
    }

    #[tokio::test]
    async fn changing_an_executed_migration_is_rejected_by_checksum() {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::open(directory.path()).await.unwrap();
        let changed_source = tempfile::tempdir().unwrap();
        std::fs::write(
            changed_source.path().join("20260902000000_initial.sql"),
            "-- deliberately changed after execution\nSELECT 1;\n",
        )
        .unwrap();
        let migrator = sqlx::migrate::Migrator::new(changed_source.path())
            .await
            .unwrap();

        let error = migrator.run(&store.pool).await.unwrap_err();
        assert!(
            error
                .to_string()
                .contains("was previously applied but has been modified")
        );
        store.pool.close().await;
    }

    #[tokio::test]
    async fn removed_non_git_directory_is_hidden_and_restored_with_original_id() {
        let root = tempfile::tempdir().unwrap();
        let store = Store::open(root.path()).await.unwrap();
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
            .await
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
        store
            .create_directory(&directory("original"))
            .await
            .unwrap();
        store
            .update_directory("original", "Renamed", "Purpose", "", None, None)
            .await
            .unwrap();
        assert_eq!(store.directory("original").await.unwrap().name, "Renamed");
        store.delete_project_directory("original").await.unwrap();
        assert!(store.directory("original").await.is_err());
        store
            .create_directory(&directory("replacement"))
            .await
            .unwrap();
        assert_eq!(
            store.directories("project").await.unwrap()[0].id,
            "original"
        );
        assert!(store.directory("replacement").await.is_err());
        store.pool.close().await;
    }

    #[tokio::test]
    async fn persists_session_order_within_workspace() {
        let root = tempfile::tempdir().unwrap();
        let store = Store::open(root.path()).await.unwrap();
        sqlx::raw_sql(
            "INSERT INTO projects(id,name,description,status,created_at,updated_at)
             VALUES('p','Project','','active','now','now');
             INSERT INTO workspaces(id,project_id,name,description,status,created_at,updated_at)
             VALUES('w','p','Workspace','','active','now','now');
             INSERT INTO sessions(id,workspace_id,name,kind,cwd,original_cwd,status,launch_started_at,created_at,updated_at)
             VALUES('s1','w','First','shell','/tmp','/tmp','running','now','2026-01-01','now');
             INSERT INTO sessions(id,workspace_id,name,kind,cwd,original_cwd,status,launch_started_at,created_at,updated_at)
             VALUES('s2','w','Second','codex','/tmp','/tmp','stopped','now','2026-01-02','now');",
        )
        .execute(&store.pool)
        .await
        .unwrap();

        store
            .reorder_sessions("w", &["s1".into(), "s2".into()])
            .await
            .unwrap();
        assert_eq!(
            store
                .sessions("w")
                .await
                .unwrap()
                .into_iter()
                .map(|session| session.id)
                .collect::<Vec<_>>(),
            vec!["s1", "s2"]
        );
        store.pool.close().await;
    }

    #[tokio::test]
    async fn transactions_constraints_cascades_and_nullable_columns_are_preserved() {
        let root = tempfile::tempdir().unwrap();
        let store = Store::open(root.path()).await.unwrap();
        let mut transaction = store.pool.begin().await.unwrap();
        sqlx::query(
            "INSERT INTO projects(id,name,created_at,updated_at) VALUES('rolled','Rolled','t','t')",
        )
        .execute(&mut *transaction)
        .await
        .unwrap();
        transaction.rollback().await.unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM projects WHERE id='rolled'")
                .fetch_one(&store.pool)
                .await
                .unwrap(),
            0
        );

        sqlx::raw_sql(
            "INSERT INTO projects(id,name,created_at,updated_at) VALUES('p','Project','t','t');
             INSERT INTO project_repositories(id,project_id,name,source_root,git_common_dir,created_at,updated_at)
             VALUES('r','p','Repository','/source','/git','t','t');
             INSERT INTO workspaces(id,project_id,name,status,created_at,updated_at)
             VALUES('w','p','Workspace','active','t','t');",
        )
        .execute(&store.pool)
        .await
        .unwrap();
        let nullable: (Option<String>, Option<String>) = sqlx::query_as(
            "SELECT base_branch,delivery_mode FROM project_repositories WHERE id='r'",
        )
        .fetch_one(&store.pool)
        .await
        .unwrap();
        assert_eq!(nullable, (None, None));
        assert!(
            sqlx::query("INSERT INTO projects(id,name,created_at,updated_at) VALUES('p','Duplicate','t','t')")
                .execute(&store.pool)
                .await
                .is_err()
        );
        sqlx::query("DELETE FROM projects WHERE id='p'")
            .execute(&store.pool)
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM workspaces WHERE id='w'")
                .fetch_one(&store.pool)
                .await
                .unwrap(),
            0
        );
        store.pool.close().await;
    }
}
