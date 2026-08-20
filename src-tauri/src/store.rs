use std::{path::Path, sync::Arc};

use async_sqlite::{Pool, PoolBuilder};
use parking_lot::Mutex;
use rusqlite::Connection;

use crate::error::Result;

mod migrations;
mod operations;
mod projects;
mod sessions;
mod todos;
mod workspaces;

pub(crate) use operations::ParentOperationUpdate;

#[derive(Clone)]
pub struct Store(Arc<Mutex<Connection>>, Pool);

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(anyhow::Error::from)?;
        }
        let mut connection = Connection::open(path)?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        connection.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
        migrations::to_latest(&mut connection, path)?;

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

pub fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::{Store, now};
    use crate::model::{Directory, Project};

    fn temporary_database(name: &str) -> (std::path::PathBuf, std::path::PathBuf) {
        let root =
            std::env::temp_dir().join(format!("treefold-{name}-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&root).expect("create temporary database root");
        let path = root.join("treefold.db");
        (root, path)
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
}
