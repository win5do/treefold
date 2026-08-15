#![allow(dead_code)] // Directory-shaped accessors are internal and expose no compatibility routes.

use std::path::Path;

use rusqlite::{named_params, params, Connection, OptionalExtension, Row};

use super::{now, Store};
use crate::{
    error::{AppError, Result},
    model::*,
};

impl Store {
    pub fn project_session_workspace(&self, project_id: &str) -> Result<Option<Workspace>> {
        let db = self.0.lock();
        let mut workspace = db
            .query_row(
                &format!("SELECT {WORKSPACE_COLUMNS} FROM workspaces WHERE project_id=? AND kind='base' LIMIT 1"),
                [project_id],
                workspace_row,
            )
            .optional()?;
        if let Some(value) = &mut workspace {
            hydrate_workspace_compat(&db, value)?;
        }
        Ok(workspace)
    }

    pub fn sync_project_session_workspace(
        &self,
        workspace: &Workspace,
        repositories: &[WorkspaceLocation],
    ) -> Result<()> {
        let mut db = self.0.lock();
        let tx = db.transaction()?;
        tx.execute(
            "INSERT INTO workspaces(id,project_id,name,description,status,kind,parent_workspace_id,runtime_id,runtime_name,created_at,updated_at)
             VALUES(:id,:project_id,:name,:description,:status,'base',NULL,:runtime_id,:runtime_name,:created_at,:updated_at)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name,status=excluded.status,updated_at=excluded.updated_at",
            named_params! {
                ":id": workspace.id, ":project_id": workspace.project_id, ":name": workspace.name,
                ":description": workspace.description, ":status": workspace.status,
                ":runtime_id": workspace.runtime_id, ":runtime_name": workspace.runtime_name,
                ":created_at": workspace.created_at, ":updated_at": workspace.updated_at,
            },
        )?;
        tx.execute(
            "DELETE FROM workspace_directories WHERE workspace_id=?",
            [&workspace.id],
        )?;
        tx.execute(
            "DELETE FROM workspace_repositories WHERE workspace_id=?",
            [&workspace.id],
        )?;
        insert_workspace_repositories(&tx, workspace, repositories)?;
        snapshot_workspace_directories(&tx, workspace)?;
        tx.commit()?;
        Ok(())
    }

    pub fn workspaces(&self, project_id: &str) -> Result<Vec<Workspace>> {
        let db = self.0.lock();
        let mut statement = db.prepare(&format!(
            "SELECT {WORKSPACE_COLUMNS} FROM workspaces WHERE project_id=? ORDER BY updated_at DESC"
        ))?;
        let mut values = statement
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
        workspace: &Workspace,
        repositories: &[WorkspaceLocation],
    ) -> Result<()> {
        let mut db = self.0.lock();
        let tx = db.transaction()?;
        tx.execute(
            "INSERT INTO workspaces(id,project_id,name,description,status,kind,parent_workspace_id,runtime_id,runtime_name,created_at,updated_at)
             VALUES(:id,:project_id,:name,:description,:status,:kind,:parent_workspace_id,:runtime_id,:runtime_name,:created_at,:updated_at)",
            named_params! {
                ":id": workspace.id, ":project_id": workspace.project_id, ":name": workspace.name,
                ":description": workspace.description, ":status": workspace.status, ":kind": workspace.kind,
                ":parent_workspace_id": workspace.parent_workspace_id, ":runtime_id": workspace.runtime_id,
                ":runtime_name": workspace.runtime_name, ":created_at": workspace.created_at,
                ":updated_at": workspace.updated_at,
            },
        )?;
        insert_workspace_repositories(&tx, workspace, repositories)?;
        snapshot_workspace_directories(&tx, workspace)?;
        tx.commit()?;
        Ok(())
    }

    pub fn rename_workspace(&self, id: &str, name: &str, description: &str) -> Result<()> {
        let changed = self.0.lock().execute(
            "UPDATE workspaces SET name=?,description=?,updated_at=? WHERE id=?",
            params![name, description, now(), id],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }

    pub fn delete_workspace(&self, id: &str) -> Result<()> {
        let changed = self
            .0
            .lock()
            .execute("DELETE FROM workspaces WHERE id=?", [id])?;
        if changed == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }

    pub fn workspace_locations(&self, workspace_id: &str) -> Result<Vec<WorkspaceLocation>> {
        let db = self.0.lock();
        let mut statement = db.prepare(&format!(
            "SELECT {WORKSPACE_LOCATION_COLUMNS} FROM workspace_repositories WHERE workspace_id=? ORDER BY repository_name"
        ))?;
        let values = statement
            .query_map([workspace_id], workspace_location_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(values)
    }

    pub fn workspace_repositories(&self, workspace_id: &str) -> Result<Vec<WorkspaceLocation>> {
        self.workspace_locations(workspace_id)
    }

    pub fn workspace_directories(&self, workspace_id: &str) -> Result<Vec<WorkspaceDirectory>> {
        let db = self.0.lock();
        let mut statement = db.prepare(&format!(
            "SELECT {WORKSPACE_DIRECTORY_COLUMNS} FROM workspace_directories wd
             LEFT JOIN workspace_repositories wr ON wr.id=wd.workspace_repository_id
             WHERE wd.workspace_id=? ORDER BY wd.name,wd.id"
        ))?;
        let values = statement
            .query_map([workspace_id], workspace_directory_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(values)
    }

    pub fn workspace_location(&self, id: &str) -> Result<WorkspaceLocation> {
        let db = self.0.lock();
        Ok(db.query_row(
            &format!("SELECT {WORKSPACE_LOCATION_COLUMNS} FROM workspace_repositories WHERE id=?"),
            [id],
            workspace_location_row,
        )?)
    }

    pub fn workspace_repository(&self, id: &str) -> Result<WorkspaceLocation> {
        self.workspace_location(id)
    }

    pub fn set_workspace_location_creation_result(
        &self,
        id: &str,
        git_status: &str,
        checkout_path: Option<&str>,
        start_commit: Option<&str>,
        creation_error: Option<&str>,
    ) -> Result<()> {
        let delivery_status = if git_status == "failed" {
            "discarded"
        } else {
            "active"
        };
        let changed = self.0.lock().execute(
            "UPDATE workspace_repositories SET git_status=?,checkout_path=?,start_commit=?,creation_error=?,delivery_status=?,updated_at=? WHERE id=?",
            params![git_status, checkout_path, start_commit, creation_error, delivery_status, now(), id],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }

    pub fn set_workspace_location_creation_error(&self, id: &str, error: &str) -> Result<()> {
        let changed = self.0.lock().execute(
            "UPDATE workspace_repositories SET creation_error=?,updated_at=? WHERE id=?",
            params![error, now(), id],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }

    pub fn workspace_locations_for_project_location(
        &self,
        project_id: &str,
    ) -> Result<Vec<WorkspaceLocation>> {
        let db = self.0.lock();
        let repository_id: Option<String> = db
            .query_row(
                "SELECT repository_id FROM project_directories WHERE id=?",
                [project_id],
                |row| row.get(0),
            )
            .optional()?
            .flatten()
            .or_else(|| Some(project_id.to_owned()));
        let Some(repository_id) = repository_id else {
            return Ok(Vec::new());
        };
        let mut statement = db.prepare(&format!(
            "SELECT {WORKSPACE_LOCATION_COLUMNS} FROM workspace_repositories WHERE project_repository_id=? ORDER BY created_at"
        ))?;
        let values = statement
            .query_map([repository_id], workspace_location_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(values)
    }

    pub fn default_workspace_location(&self, workspace_id: &str) -> Result<WorkspaceLocation> {
        let db = self.0.lock();
        Ok(db.query_row(
            &format!("SELECT {WORKSPACE_LOCATION_COLUMNS} FROM workspace_repositories
             WHERE workspace_id=? ORDER BY git_status='ready' DESC,
             project_repository_id=(SELECT d.repository_id FROM workspaces w JOIN projects p ON p.id=w.project_id LEFT JOIN project_directories d ON d.id=p.default_directory_id WHERE w.id=workspace_repositories.workspace_id) DESC LIMIT 1"),
            [workspace_id], workspace_location_row,
        )?)
    }

    pub(super) fn resolve_workspace_location_id(
        &self,
        workspace_or_repository_id: &str,
    ) -> Result<String> {
        let db = self.0.lock();
        if let Some(id) = db
            .query_row(
                "SELECT id FROM workspace_repositories WHERE id=?",
                [workspace_or_repository_id],
                |row| row.get(0),
            )
            .optional()?
        {
            return Ok(id);
        }
        Ok(db.query_row(
            "SELECT wr.id FROM workspace_repositories wr JOIN workspaces w ON w.id=wr.workspace_id
             JOIN projects p ON p.id=w.project_id LEFT JOIN project_directories d ON d.id=p.default_directory_id
             WHERE wr.workspace_id=? ORDER BY wr.git_status='ready' DESC,wr.project_repository_id=d.repository_id DESC LIMIT 1",
            [workspace_or_repository_id], |row| row.get(0),
        )?)
    }

    pub(crate) fn forks(&self, workspace_id: &str) -> Result<Vec<Workspace>> {
        let db = self.0.lock();
        let mut statement = db.prepare(&format!(
            "SELECT {WORKSPACE_COLUMNS} FROM workspaces WHERE parent_workspace_id=? ORDER BY updated_at DESC"
        ))?;
        let values = statement
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
        tx.execute("UPDATE workspace_repositories SET delivery_status=?,close_outcome=?,integrated_commit=?,closed_at=?,updated_at=? WHERE workspace_id=?", params![delivery_status,close_outcome,integrated_commit,timestamp,timestamp,id])?;
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
            "UPDATE workspace_repositories SET delivery_status=?,close_outcome=?,integrated_commit=?,closed_at=?,updated_at=? WHERE id=?",
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
            "SELECT EXISTS(SELECT 1 FROM workspace_repositories WHERE workspace_id=? AND delivery_status NOT IN ('delivered','kept','discarded','remote_merged'))",
            [id], |row| row.get(0),
        )?;
        if unfinished {
            return Err(AppError::BadRequest(
                "all Repositories must be finished before archiving the Workspace".into(),
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

    pub fn workspace_detail(&self, id: &str) -> Result<WorkspaceDetail> {
        let workspace = self.workspace(id)?;
        Ok(WorkspaceDetail {
            project: self.project(&workspace.project_id)?,
            repositories: self.workspace_repositories(id)?,
            directories: self.workspace_directories(id)?,
            sessions: self.sessions(id)?,
            todos: self.todos(id)?,
            forks: self.forks(id)?,
            workspace,
        })
    }
}

pub(super) const WORKSPACE_COLUMNS: &str = "id,project_id,name,description,status,kind,parent_workspace_id,runtime_id,runtime_name,created_at,updated_at";

pub(super) fn workspace_row(row: &Row<'_>) -> rusqlite::Result<Workspace> {
    Ok(Workspace {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        name: row.get("name")?,
        description: row.get("description")?,
        status: row.get("status")?,
        kind: row.get("kind")?,
        parent_workspace_id: row.get("parent_workspace_id")?,
        runtime_id: row.get("runtime_id")?,
        runtime_name: row.get("runtime_name")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
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

pub(super) const WORKSPACE_LOCATION_COLUMNS: &str = "id,workspace_id,project_repository_id AS project_location_id,repository_name AS location_name,source_root AS source_path,'read_write' AS access_mode,git_status,creation_error,worktree_id,checkout_path,branch,base_branch,start_commit,forked_from_commit,remote_name,remote_branch,branch_ownership,delivery_mode,delivery_status,close_outcome,integrated_commit,closed_at,created_at,updated_at";
pub(super) const WORKSPACE_DIRECTORY_COLUMNS: &str = "wd.id,wd.workspace_id,wd.project_directory_id,wd.workspace_repository_id,wd.name,wd.description,wd.relative_path,wd.external_path,wd.access_mode,wd.status,wd.created_at,wd.updated_at,wr.checkout_path,wr.source_root,(SELECT kind FROM workspaces WHERE id=wd.workspace_id) AS workspace_kind";

pub(super) fn workspace_location_row(row: &Row<'_>) -> rusqlite::Result<WorkspaceLocation> {
    Ok(WorkspaceLocation {
        id: row.get("id")?,
        workspace_id: row.get("workspace_id")?,
        project_location_id: row.get("project_location_id")?,
        location_name: row.get("location_name")?,
        source_path: row.get("source_path")?,
        access_mode: row.get("access_mode")?,
        git_status: row.get("git_status")?,
        creation_error: row.get("creation_error")?,
        worktree_id: row.get("worktree_id")?,
        checkout_path: row.get("checkout_path")?,
        branch: row.get("branch")?,
        base_branch: row.get("base_branch")?,
        start_commit: row.get("start_commit")?,
        forked_from_commit: row.get("forked_from_commit")?,
        remote_name: row.get("remote_name")?,
        remote_branch: row.get("remote_branch")?,
        branch_ownership: row.get("branch_ownership")?,
        delivery_mode: row.get("delivery_mode")?,
        delivery_status: row.get("delivery_status")?,
        close_outcome: row.get("close_outcome")?,
        integrated_commit: row.get("integrated_commit")?,
        closed_at: row.get("closed_at")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub(super) fn workspace_directory_row(row: &Row<'_>) -> rusqlite::Result<WorkspaceDirectory> {
    let relative: Option<String> = row.get("relative_path")?;
    let external: Option<String> = row.get("external_path")?;
    let checkout: Option<String> = row.get("checkout_path")?;
    let source_root: Option<String> = row.get("source_root")?;
    let workspace_kind: String = row.get("workspace_kind")?;
    let root = if workspace_kind == "base" {
        source_root
    } else {
        checkout
    };
    let path = match (root.as_deref(), relative.as_deref(), external.as_deref()) {
        (Some(root), Some("."), _) => root.into(),
        (Some(root), Some(relative), _) => Path::new(root)
            .join(relative)
            .to_string_lossy()
            .into_owned(),
        (_, _, Some(path)) => path.into(),
        _ => String::new(),
    };
    Ok(WorkspaceDirectory {
        id: row.get("id")?,
        workspace_id: row.get("workspace_id")?,
        project_directory_id: row.get("project_directory_id")?,
        workspace_repository_id: row.get("workspace_repository_id")?,
        name: row.get("name")?,
        description: row.get("description")?,
        relative_path: relative,
        external_path: external,
        path,
        access_mode: row.get("access_mode")?,
        status: row.get("status")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub(super) fn hydrate_workspace_compat(
    db: &Connection,
    workspace: &mut Workspace,
) -> rusqlite::Result<()> {
    if workspace.kind == "base" {
        workspace.checkout_mode = "in_place".into();
        workspace.branch_ownership = "user".into();
    }
    let repository = db.query_row(
        &format!("SELECT {WORKSPACE_LOCATION_COLUMNS} FROM workspace_repositories
         WHERE workspace_id=? ORDER BY git_status='ready' DESC,
         project_repository_id=(SELECT d.repository_id FROM workspaces w JOIN projects p ON p.id=w.project_id LEFT JOIN project_directories d ON d.id=p.default_directory_id WHERE w.id=workspace_repositories.workspace_id) DESC LIMIT 1"),
        [&workspace.id], workspace_location_row,
    ).optional()?;
    if let Some(repository) = repository {
        let default_directory: Option<String> = db
            .query_row(
                "SELECT default_directory_id FROM projects WHERE id=?",
                [&workspace.project_id],
                |row| row.get(0),
            )
            .optional()?
            .flatten();
        workspace.project_directory_id = default_directory.unwrap_or_default();
        workspace.worktree_id = repository.worktree_id;
        workspace.checkout_path = repository
            .checkout_path
            .unwrap_or_else(|| repository.source_path.clone());
        workspace.target_branch = repository.base_branch.unwrap_or_default();
        workspace.start_commit = repository.start_commit.unwrap_or_default();
        workspace.branch = repository.branch.unwrap_or_default();
        workspace.forked_from_commit = repository.forked_from_commit;
        workspace.remote_name = repository.remote_name;
        workspace.remote_branch = repository.remote_branch;
        workspace.branch_ownership = repository.branch_ownership;
        workspace.delivery_mode = repository.delivery_mode;
        workspace.delivery_status = repository.delivery_status;
        workspace.close_outcome = repository.close_outcome;
        workspace.integrated_commit = repository.integrated_commit;
        workspace.closed_at = repository.closed_at;
    }
    if workspace.kind == "base" {
        workspace.checkout_mode = "in_place".into();
        workspace.branch_ownership = "user".into();
        workspace.delivery_status = "not_applicable".into();
    }
    Ok(())
}

fn insert_workspace_repositories(
    tx: &rusqlite::Transaction<'_>,
    workspace: &Workspace,
    values: &[WorkspaceLocation],
) -> rusqlite::Result<()> {
    for value in values {
        let project_repository_id: Option<String> = tx
            .query_row(
                "SELECT repository_id FROM project_directories WHERE id=?",
                [&value.project_location_id],
                |row| row.get(0),
            )
            .optional()?
            .flatten()
            .or_else(|| {
                tx.query_row(
                    "SELECT id FROM project_repositories WHERE id=?",
                    [&value.project_location_id],
                    |row| row.get(0),
                )
                .optional()
                .ok()
                .flatten()
            });
        let Some(project_repository_id) = project_repository_id else {
            continue;
        };
        let source: (String, String) = tx.query_row(
            "SELECT name,source_root FROM project_repositories WHERE id=?",
            [&project_repository_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        tx.execute(
            "INSERT OR IGNORE INTO workspace_repositories(id,workspace_id,project_repository_id,repository_name,source_root,git_status,creation_error,worktree_id,checkout_path,branch,base_branch,start_commit,forked_from_commit,remote_name,remote_branch,branch_ownership,delivery_mode,delivery_status,close_outcome,integrated_commit,closed_at,created_at,updated_at)
             VALUES(:id,:workspace_id,:project_repository_id,:repository_name,:source_root,:git_status,:creation_error,:worktree_id,:checkout_path,:branch,:base_branch,:start_commit,:forked_from_commit,:remote_name,:remote_branch,:branch_ownership,:delivery_mode,:delivery_status,:close_outcome,:integrated_commit,:closed_at,:created_at,:updated_at)",
            named_params! {
                ":id": value.id, ":workspace_id": workspace.id, ":project_repository_id": project_repository_id,
                ":repository_name": source.0, ":source_root": source.1, ":git_status": value.git_status,
                ":creation_error": value.creation_error, ":worktree_id": value.worktree_id, ":checkout_path": value.checkout_path,
                ":branch": value.branch, ":base_branch": value.base_branch, ":start_commit": value.start_commit,
                ":forked_from_commit": value.forked_from_commit, ":remote_name": value.remote_name, ":remote_branch": value.remote_branch,
                ":branch_ownership": value.branch_ownership, ":delivery_mode": value.delivery_mode, ":delivery_status": value.delivery_status,
                ":close_outcome": value.close_outcome, ":integrated_commit": value.integrated_commit, ":closed_at": value.closed_at,
                ":created_at": value.created_at, ":updated_at": value.updated_at,
            },
        )?;
    }
    Ok(())
}

fn snapshot_workspace_directories(
    tx: &rusqlite::Transaction<'_>,
    workspace: &Workspace,
) -> rusqlite::Result<()> {
    tx.execute(
        "INSERT INTO workspace_directories(id,workspace_id,project_directory_id,workspace_repository_id,name,description,relative_path,external_path,access_mode,status,created_at,updated_at)
         SELECT ? || '-' || d.id,?,d.id,wr.id,d.name,d.description,d.relative_path,d.external_path,
                CASE WHEN d.repository_id IS NULL THEN 'read_only' ELSE 'read_write' END,d.status,?,?
         FROM project_directories d LEFT JOIN workspace_repositories wr
           ON wr.workspace_id=? AND wr.project_repository_id=d.repository_id WHERE d.project_id=?",
        params![workspace.id,workspace.id,workspace.created_at,workspace.updated_at,workspace.id,workspace.project_id],
    )?;
    Ok(())
}
