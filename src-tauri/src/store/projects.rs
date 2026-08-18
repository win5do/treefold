#![allow(dead_code)] // Directory-shaped accessors bridge internal call sites, not removed HTTP routes.

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, Row, named_params, params};

use super::{Store, now};
use super::{
    sessions::{SESSION_COLUMNS, session_row},
    workspaces::{
        WORKSPACE_COLUMNS, WORKSPACE_DIRECTORY_COLUMNS, WORKSPACE_LOCATION_COLUMNS,
        hydrate_workspace_compat, workspace_directory_row, workspace_location_row, workspace_row,
    },
};
use crate::{
    error::{AppError, Result},
    model::*,
};

const PROJECT_COLUMNS: &str =
    "id,name,description,status,default_directory_id,created_at,updated_at";
const DIRECTORY_COLUMNS: &str = "d.id,d.project_id,d.repository_id,d.name,d.description,d.relative_path,d.external_path,d.status,d.created_at,d.updated_at,r.name AS repository_name,r.source_root,r.git_common_dir,r.repository_url,r.preferred_remote_name,r.base_branch,r.delivery_mode,r.setup_command,r.setup_workdir,r.git_status AS repository_status,r.last_checked_at";

impl Store {
    pub async fn project_summaries_async(&self) -> Result<Vec<ProjectSummary>> {
        self.1.conn_and_then(project_summaries_on).await
    }

    pub async fn sidebar_async(&self) -> Result<SidebarData> {
        self.1.conn_and_then(sidebar_on).await
    }

    pub fn projects(&self) -> Result<Vec<Project>> {
        let db = self.0.lock();
        let mut statement = db.prepare(&format!(
            "SELECT {PROJECT_COLUMNS} FROM projects ORDER BY updated_at DESC"
        ))?;
        let values = statement
            .query_map([], project_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(values)
    }

    pub fn project(&self, id: &str) -> Result<Project> {
        let db = self.0.lock();
        Ok(db.query_row(
            &format!("SELECT {PROJECT_COLUMNS} FROM projects WHERE id=?"),
            [id],
            project_row,
        )?)
    }

    pub fn create_empty_project(&self, project: &Project) -> Result<()> {
        self.0.lock().execute(
            "INSERT INTO projects(id,name,description,status,default_directory_id,created_at,updated_at)
             VALUES(:id,:name,:description,:status,:default_directory_id,:created_at,:updated_at)",
            named_params! {
                ":id": project.id,
                ":name": project.name,
                ":description": project.description,
                ":status": project.status,
                ":default_directory_id": project.default_location_id,
                ":created_at": project.created_at,
                ":updated_at": project.updated_at,
            },
        )?;
        Ok(())
    }

    pub fn update_project_defaults(
        &self,
        id: &str,
        default_directory_id: Option<&str>,
        _default_base_branch: &str,
        _default_delivery_mode: &str,
    ) -> Result<()> {
        let changed = self.0.lock().execute(
            "UPDATE projects SET default_directory_id=?,updated_at=? WHERE id=?",
            params![default_directory_id, now(), id],
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
            return Err(AppError::NotFound);
        }
        Ok(())
    }

    pub fn rename_project(&self, id: &str, name: &str, description: &str) -> Result<()> {
        let changed = self.0.lock().execute(
            "UPDATE projects SET name=?,description=?,updated_at=? WHERE id=?",
            params![name, description, now(), id],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }

    pub fn delete_project(&self, id: &str) -> Result<()> {
        let changed = self
            .0
            .lock()
            .execute("DELETE FROM projects WHERE id=?", [id])?;
        if changed == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }

    pub fn repositories(&self, project_id: &str) -> Result<Vec<ProjectRepository>> {
        let db = self.0.lock();
        let mut statement = db.prepare(
            "SELECT id,project_id,name,source_root,git_common_dir,repository_url,preferred_remote_name,base_branch,delivery_mode,setup_command,setup_workdir,git_status,last_checked_at,created_at,updated_at
             FROM project_repositories WHERE project_id=? AND deleted_at IS NULL ORDER BY created_at,id",
        )?;
        let values = statement
            .query_map([project_id], project_repository_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(values)
    }

    pub fn repository(&self, id: &str) -> Result<ProjectRepository> {
        let db = self.0.lock();
        Ok(db.query_row(
            "SELECT id,project_id,name,source_root,git_common_dir,repository_url,preferred_remote_name,base_branch,delivery_mode,setup_command,setup_workdir,git_status,last_checked_at,created_at,updated_at FROM project_repositories WHERE id=? AND deleted_at IS NULL",
            [id],
            project_repository_row,
        )?)
    }

    pub fn repository_as_directory(&self, id: &str) -> Result<Directory> {
        let repository = self.repository(id)?;
        Ok(Directory {
            id: repository.id,
            project_id: repository.project_id,
            name: repository.name,
            description: String::new(),
            worktree_setup_command: repository.setup_command,
            path: repository.source_root.clone(),
            repository_url: repository.repository_url.clone(),
            preferred_remote_name: repository.preferred_remote_name,
            base_branch: Some(repository.base_branch),
            delivery_mode: Some(repository.delivery_mode),
            git_common_dir: Some(repository.git_common_dir),
            git_status: repository.git_status,
            last_checked_at: repository.last_checked_at,
            created_at: repository.created_at,
            updated_at: repository.updated_at,
            checkout_path: Some(repository.source_root),
            role: "repository".into(),
            is_git: true,
            remote_url: repository.repository_url,
            branch: None,
            head_commit: None,
            head_summary: None,
            dirty: false,
        })
    }

    pub fn directories(&self, project_id: &str) -> Result<Vec<Directory>> {
        let db = self.0.lock();
        let mut statement = db.prepare(&format!(
            "SELECT {DIRECTORY_COLUMNS} FROM project_directories d
             LEFT JOIN project_repositories r ON r.id=d.repository_id
             JOIN projects p ON p.id=d.project_id WHERE d.project_id=? AND d.deleted_at IS NULL AND (r.id IS NULL OR r.deleted_at IS NULL)
             ORDER BY d.id=p.default_directory_id DESC,d.created_at,d.rowid"
        ))?;
        let values = statement
            .query_map([project_id], directory_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(values)
    }

    pub fn project_directories(&self, project_id: &str) -> Result<Vec<ProjectDirectory>> {
        let db = self.0.lock();
        let mut statement = db.prepare(&format!(
            "SELECT {DIRECTORY_COLUMNS} FROM project_directories d
             LEFT JOIN project_repositories r ON r.id=d.repository_id
             JOIN projects p ON p.id=d.project_id WHERE d.project_id=? AND d.deleted_at IS NULL AND (r.id IS NULL OR r.deleted_at IS NULL)
             ORDER BY d.id=p.default_directory_id DESC,r.created_at,d.created_at,d.id"
        ))?;
        let values = statement
            .query_map([project_id], project_directory_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(values)
    }

    pub fn directory(&self, id: &str) -> Result<Directory> {
        let db = self.0.lock();
        Ok(db.query_row(
            &format!("SELECT {DIRECTORY_COLUMNS} FROM project_directories d LEFT JOIN project_repositories r ON r.id=d.repository_id WHERE d.id=? AND d.deleted_at IS NULL AND (r.id IS NULL OR r.deleted_at IS NULL)"),
            [id],
            directory_row,
        )?)
    }

    pub fn directory_record(&self, id: &str) -> Result<ProjectDirectory> {
        let db = self.0.lock();
        Ok(db.query_row(
            &format!("SELECT {DIRECTORY_COLUMNS} FROM project_directories d LEFT JOIN project_repositories r ON r.id=d.repository_id WHERE d.id=? AND d.deleted_at IS NULL AND (r.id IS NULL OR r.deleted_at IS NULL)"),
            [id],
            project_directory_row,
        )?)
    }

    pub fn directory_repository_id(&self, id: &str) -> Result<Option<String>> {
        let db = self.0.lock();
        Ok(db.query_row(
            "SELECT repository_id FROM project_directories WHERE id=? AND deleted_at IS NULL",
            [id],
            |row| row.get(0),
        )?)
    }

    pub fn create_directory(&self, directory: &Directory) -> Result<String> {
        self.create_directory_with_repository_id(directory, None)
    }

    pub fn create_directory_with_repository_id(
        &self,
        directory: &Directory,
        forced_repository_id: Option<&str>,
    ) -> Result<String> {
        let mut db = self.0.lock();
        let tx = db.transaction()?;
        let repository_id = if let Some(git_common_dir) = directory.git_common_dir.as_deref() {
            let source_root = directory
                .checkout_path
                .as_deref()
                .unwrap_or(&directory.path);
            let existing: Option<(String, String, Option<String>)> = tx
                .query_row(
                    "SELECT id,source_root,deleted_at FROM project_repositories WHERE project_id=? AND git_common_dir=?",
                    params![directory.project_id, git_common_dir],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .optional()?;
            if let Some((id, existing_root, deleted_at)) = existing {
                if deleted_at.is_none()
                    && normalized_path(&existing_root) != normalized_path(source_root)
                {
                    return Err(AppError::BadRequest(format!(
                        "repository is already associated with source worktree {existing_root}; add scopes from that worktree"
                    )));
                }
                if deleted_at.is_some() {
                    tx.execute(
                        "UPDATE project_repositories SET name=?,source_root=?,repository_url=?,preferred_remote_name=?,git_status=?,last_checked_at=?,updated_at=?,deleted_at=NULL WHERE id=?",
                        params![basename(source_root),source_root,directory.repository_url,directory.preferred_remote_name,directory.git_status,directory.last_checked_at,directory.updated_at,id],
                    )?;
                }
                id
            } else {
                let id = forced_repository_id
                    .map(str::to_owned)
                    .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
                tx.execute(
                    "INSERT INTO project_repositories(id,project_id,name,source_root,git_common_dir,repository_url,preferred_remote_name,base_branch,delivery_mode,setup_command,setup_workdir,git_status,last_checked_at,created_at,updated_at)
                     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    params![
                        id,
                        directory.project_id,
                        basename(source_root),
                        source_root,
                        git_common_dir,
                        directory.repository_url,
                        directory.preferred_remote_name,
                        directory.base_branch.as_deref().unwrap_or("main"),
                        directory.delivery_mode.as_deref().unwrap_or("remote_review"),
                        directory.worktree_setup_command,
                        ".",
                        directory.git_status,
                        directory.last_checked_at,
                        directory.created_at,
                        directory.updated_at,
                    ],
                )?;
                id
            }
        } else {
            String::new()
        };
        let relative_path = if repository_id.is_empty() {
            None
        } else {
            Some(relative_scope(
                directory
                    .checkout_path
                    .as_deref()
                    .unwrap_or(&directory.path),
                &directory.path,
            )?)
        };
        let existing_directory: Option<(String, Option<String>)> = if repository_id.is_empty() {
            tx.query_row(
                "SELECT id,deleted_at FROM project_directories WHERE project_id=? AND external_path=?",
                params![directory.project_id, directory.path],
                |row| Ok((row.get(0)?, row.get(1)?)),
            ).optional()?
        } else {
            tx.query_row(
                "SELECT id,deleted_at FROM project_directories WHERE repository_id=? AND relative_path=?",
                params![repository_id, relative_path],
                |row| Ok((row.get(0)?, row.get(1)?)),
            ).optional()?
        };
        if let Some((existing_id, deleted_at)) = existing_directory {
            if deleted_at.is_none() {
                return Err(AppError::BadRequest(
                    "directory is already part of this Project".into(),
                ));
            }
            tx.execute(
                "UPDATE project_directories SET name=?,description=?,status=?,updated_at=?,deleted_at=NULL WHERE id=?",
                params![directory.name,directory.description,directory.git_status,directory.updated_at,existing_id],
            )?;
            if directory.git_common_dir.is_some() {
                tx.execute(
                    "UPDATE projects SET default_directory_id=COALESCE(default_directory_id,?),updated_at=? WHERE id=?",
                    params![existing_id, now(), directory.project_id],
                )?;
            }
            tx.commit()?;
            return Ok(existing_id);
        }
        tx.execute(
            "INSERT INTO project_directories(id,project_id,repository_id,name,description,relative_path,external_path,status,created_at,updated_at)
             VALUES(?,?,?,?,?,?,?,?,?,?)",
            params![
                directory.id,
                directory.project_id,
                (!repository_id.is_empty()).then_some(repository_id),
                directory.name,
                directory.description,
                relative_path,
                directory.git_common_dir.is_none().then_some(directory.path.clone()),
                directory.git_status,
                directory.created_at,
                directory.updated_at,
            ],
        )?;
        if directory.git_common_dir.is_some() {
            tx.execute(
                "UPDATE projects SET default_directory_id=COALESCE(default_directory_id,?),updated_at=? WHERE id=?",
                params![directory.id, now(), directory.project_id],
            )?;
        }
        tx.commit()?;
        Ok(directory.id.clone())
    }

    pub fn update_directory(
        &self,
        id: &str,
        name: &str,
        description: &str,
        setup_command: &str,
        base_branch: Option<&str>,
        delivery_mode: Option<&str>,
    ) -> Result<()> {
        let mut db = self.0.lock();
        let tx = db.transaction()?;
        let repository_id: Option<String> = tx.query_row(
            "SELECT repository_id FROM project_directories WHERE id=? AND deleted_at IS NULL",
            [id],
            |row| row.get(0),
        )?;
        tx.execute(
            "UPDATE project_directories SET name=?,description=?,updated_at=? WHERE id=? AND deleted_at IS NULL",
            params![name, description, now(), id],
        )?;
        if let Some(repository_id) = repository_id {
            tx.execute(
                "UPDATE project_repositories SET setup_command=?,base_branch=COALESCE(?,base_branch),delivery_mode=COALESCE(?,delivery_mode),updated_at=? WHERE id=?",
                params![setup_command, base_branch, delivery_mode, now(), repository_id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn update_repository(
        &self,
        id: &str,
        setup_command: &str,
        setup_workdir: &str,
        base_branch: &str,
        delivery_mode: &str,
    ) -> Result<()> {
        let changed = self.0.lock().execute(
            "UPDATE project_repositories SET setup_command=?,setup_workdir=?,base_branch=?,delivery_mode=?,updated_at=? WHERE id=? AND deleted_at IS NULL",
            params![setup_command,setup_workdir,base_branch,delivery_mode,now(),id],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }

    pub fn update_repository_base(
        &self,
        id: &str,
        base_branch: &str,
        preferred_remote_name: Option<&str>,
    ) -> Result<()> {
        let changed = self.0.lock().execute(
            "UPDATE project_repositories SET base_branch=?,preferred_remote_name=?,updated_at=? WHERE id=? AND deleted_at IS NULL",
            params![base_branch,preferred_remote_name,now(),id],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }

    pub fn refresh_repository(&self, repository: &ProjectRepository) -> Result<()> {
        let changed = self.0.lock().execute(
            "UPDATE project_repositories SET name=?,source_root=?,git_common_dir=?,repository_url=?,preferred_remote_name=?,base_branch=?,delivery_mode=?,setup_command=?,setup_workdir=?,git_status=?,last_checked_at=?,updated_at=? WHERE id=? AND deleted_at IS NULL",
            params![repository.name,repository.source_root,repository.git_common_dir,repository.repository_url,repository.preferred_remote_name,repository.base_branch,repository.delivery_mode,repository.setup_command,repository.setup_workdir,repository.git_status,repository.last_checked_at,repository.updated_at,repository.id],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }

    pub fn reattach_repository(
        &self,
        id: &str,
        source_root: &str,
        git_common_dir: &str,
        repository_url: Option<&str>,
        preferred_remote_name: Option<&str>,
    ) -> Result<()> {
        let changed = self.0.lock().execute(
            "UPDATE project_repositories SET source_root=?,git_common_dir=?,repository_url=?,preferred_remote_name=?,git_status='ready',last_checked_at=?,updated_at=? WHERE id=? AND deleted_at IS NULL",
            params![source_root,git_common_dir,repository_url,preferred_remote_name,now(),now(),id],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }

    pub fn refresh_project_location(&self, directory: &ProjectLocation) -> Result<()> {
        let mut db = self.0.lock();
        let tx = db.transaction()?;
        let repository_id: Option<String> = tx.query_row(
            "SELECT repository_id FROM project_directories WHERE id=? AND deleted_at IS NULL",
            [&directory.id],
            |row| row.get(0),
        )?;
        tx.execute(
            "UPDATE project_directories SET name=?,status=?,updated_at=? WHERE id=? AND deleted_at IS NULL",
            params![
                directory.name,
                directory.git_status,
                directory.updated_at,
                directory.id
            ],
        )?;
        if let Some(repository_id) = repository_id {
            tx.execute(
                "UPDATE project_repositories SET source_root=COALESCE(?,source_root),repository_url=COALESCE(repository_url,?),preferred_remote_name=COALESCE(preferred_remote_name,?),base_branch=COALESCE(?,base_branch),delivery_mode=COALESCE(?,delivery_mode),git_common_dir=COALESCE(?,git_common_dir),git_status=?,last_checked_at=?,updated_at=? WHERE id=? AND deleted_at IS NULL",
                params![directory.checkout_path,directory.repository_url,directory.preferred_remote_name,directory.base_branch,directory.delivery_mode,directory.git_common_dir,directory.git_status,directory.last_checked_at,directory.updated_at,repository_id],
            )?;
        }
        tx.commit()?;
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
            "UPDATE project_repositories SET source_root=?,git_common_dir=?,repository_url=?,preferred_remote_name=?,git_status='ready',last_checked_at=?,updated_at=? WHERE id=(SELECT repository_id FROM project_directories WHERE id=?)",
            params![path,git_common_dir,repository_url,preferred_remote_name,now(),now(),id],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }

    pub fn delete_project_location(&self, id: &str) -> Result<()> {
        let mut db = self.0.lock();
        let tx = db.transaction()?;
        let (project_id, repository_id, is_default): (String, Option<String>, bool) = tx.query_row(
            "SELECT d.project_id,d.repository_id,COALESCE(d.id=p.default_directory_id,0) FROM project_directories d JOIN projects p ON p.id=d.project_id WHERE d.id=? AND d.deleted_at IS NULL",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;
        if is_default {
            return Err(AppError::BadRequest(
                "choose another default Directory before removing this one".into(),
            ));
        }
        let referenced: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM workspace_directories wd JOIN workspaces w ON w.id=wd.workspace_id WHERE wd.project_directory_id=? AND w.status='active')",
            [id],
            |row| row.get(0),
        )?;
        if referenced {
            return Err(AppError::BadRequest(
                "directory is used by an active Workspace or Fork".into(),
            ));
        }
        let timestamp = now();
        tx.execute("UPDATE project_directories SET deleted_at=?,updated_at=? WHERE id=? AND deleted_at IS NULL", params![timestamp,timestamp,id])?;
        if let Some(repository_id) = repository_id {
            let has_scopes: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM project_directories WHERE repository_id=? AND deleted_at IS NULL)",
                [&repository_id],
                |row| row.get(0),
            )?;
            if !has_scopes {
                let snapshotted: bool = tx.query_row(
                    "SELECT EXISTS(SELECT 1 FROM workspace_repositories wr JOIN workspaces w ON w.id=wr.workspace_id WHERE wr.project_repository_id=? AND w.status='active')",
                    [&repository_id],
                    |row| row.get(0),
                )?;
                if snapshotted {
                    return Err(AppError::BadRequest(
                        "repository is used by an active Workspace or Fork".into(),
                    ));
                }
                tx.execute("UPDATE project_repositories SET deleted_at=?,updated_at=? WHERE id=? AND deleted_at IS NULL", params![timestamp,timestamp,repository_id])?;
            }
        }
        tx.execute(
            "UPDATE projects SET updated_at=? WHERE id=?",
            params![now(), project_id],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn delete_repository(&self, id: &str) -> Result<()> {
        let mut db = self.0.lock();
        let tx = db.transaction()?;
        let referenced: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM workspace_repositories wr JOIN workspaces w ON w.id=wr.workspace_id WHERE wr.project_repository_id=? AND w.status='active')",
            [id],
            |row| row.get(0),
        )?;
        if referenced {
            return Err(AppError::BadRequest(
                "repository is used by an active Workspace or Fork".into(),
            ));
        }
        let contains_default: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM project_directories d JOIN projects p ON p.default_directory_id=d.id WHERE d.repository_id=?)",
            [id],
            |row| row.get(0),
        )?;
        if contains_default {
            return Err(AppError::BadRequest(
                "choose a default Directory in another Repository first".into(),
            ));
        }
        let timestamp = now();
        tx.execute("UPDATE project_directories SET deleted_at=?,updated_at=? WHERE repository_id=? AND deleted_at IS NULL", params![timestamp,timestamp,id])?;
        let changed = tx.execute("UPDATE project_repositories SET deleted_at=?,updated_at=? WHERE id=? AND deleted_at IS NULL", params![timestamp,timestamp,id])?;
        if changed == 0 {
            return Err(AppError::NotFound);
        }
        tx.commit()?;
        Ok(())
    }

    pub fn project_detail(&self, id: &str) -> Result<ProjectDetail> {
        Ok(ProjectDetail {
            project: self.project(id)?,
            repositories: self.repositories(id)?,
            directories: self.project_directories(id)?,
            sessions: self.project_sessions(id)?,
            workspaces: self
                .workspaces(id)?
                .into_iter()
                .filter(|workspace| workspace.kind == "workspace")
                .collect(),
            worktrees: Vec::new(),
        })
    }
}

fn project_summaries_on(db: &Connection) -> Result<Vec<ProjectSummary>> {
    let mut statement = db.prepare(
        "SELECT p.id,p.name,p.description,p.status,p.updated_at,
                COUNT(DISTINCT d.id),COUNT(DISTINCT CASE WHEN d.repository_id IS NOT NULL THEN d.id END),
                COUNT(DISTINCT CASE WHEN d.repository_id IS NULL THEN d.id END),
                COUNT(DISTINCT CASE WHEN d.status='missing' THEN d.id END),
                COUNT(DISTINCT CASE WHEN d.status NOT IN ('ready','not_git','missing') THEN d.id END),
                COUNT(DISTINCT CASE WHEN w.status='active' AND w.kind='workspace' THEN w.id END)
         FROM projects p LEFT JOIN project_directories d ON d.project_id=p.id AND d.deleted_at IS NULL
         LEFT JOIN workspaces w ON w.project_id=p.id GROUP BY p.id ORDER BY p.updated_at DESC",
    )?;
    let values = statement
        .query_map([], |row| {
            Ok(ProjectSummary {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                status: row.get(3)?,
                updated_at: row.get(4)?,
                location_count: row.get(5)?,
                git_location_count: row.get(6)?,
                context_location_count: row.get(7)?,
                missing_location_count: row.get(8)?,
                abnormal_location_count: row.get(9)?,
                active_workspace_count: row.get(10)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(values)
}

fn sidebar_on(db: &Connection) -> Result<SidebarData> {
    let transaction = db.unchecked_transaction()?;
    let mut project_statement = transaction.prepare(&format!(
        "SELECT {PROJECT_COLUMNS} FROM projects WHERE status='active' ORDER BY updated_at DESC"
    ))?;
    let projects = project_statement
        .query_map([], project_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(project_statement);
    let mut result = Vec::with_capacity(projects.len());
    for project in projects {
        let repositories = query_project_repositories(&transaction, &project.id)?;
        let directories = query_project_directories(&transaction, &project.id)?;
        let aliased_session_columns = format!("s.{}", SESSION_COLUMNS.replace(',', ",s."));
        let mut sessions_statement = transaction.prepare(&format!(
            "SELECT {aliased_session_columns} FROM sessions s JOIN workspaces w ON w.id=s.workspace_id
             WHERE w.project_id=? AND w.kind='base' AND s.visibility='visible' ORDER BY s.sort_order,s.created_at DESC"
        ))?;
        let sessions = sessions_statement
            .query_map([&project.id], session_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut workspace_statement = transaction.prepare(&format!(
            "SELECT {WORKSPACE_COLUMNS} FROM workspaces WHERE project_id=? AND status='active' AND kind!='base' ORDER BY updated_at DESC"
        ))?;
        let mut workspaces = workspace_statement
            .query_map([&project.id], workspace_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut sidebar_workspaces = Vec::with_capacity(workspaces.len());
        for mut workspace in workspaces.drain(..) {
            hydrate_workspace_compat(&transaction, &mut workspace)?;
            let mut statement = transaction.prepare(&format!(
                "SELECT {SESSION_COLUMNS} FROM sessions WHERE workspace_id=? AND visibility='visible' ORDER BY sort_order,created_at DESC"
            ))?;
            let workspace_sessions = statement
                .query_map([&workspace.id], session_row)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            let mut repository_statement = transaction.prepare(&format!(
                "SELECT {WORKSPACE_LOCATION_COLUMNS} FROM workspace_repositories WHERE workspace_id=? ORDER BY repository_name"
            ))?;
            let workspace_repositories = repository_statement
                .query_map([&workspace.id], workspace_location_row)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            let mut directory_statement = transaction.prepare(&format!(
                "SELECT {WORKSPACE_DIRECTORY_COLUMNS} FROM workspace_directories wd LEFT JOIN workspace_repositories wr ON wr.id=wd.workspace_repository_id WHERE wd.workspace_id=? ORDER BY wd.name"
            ))?;
            let workspace_directories = directory_statement
                .query_map([&workspace.id], workspace_directory_row)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            sidebar_workspaces.push(SidebarWorkspace {
                workspace,
                sessions: workspace_sessions,
                repositories: workspace_repositories,
                directories: workspace_directories,
            });
        }
        result.push(SidebarProject {
            project,
            repositories,
            directories,
            sessions,
            workspaces: sidebar_workspaces,
        });
    }
    drop(transaction);
    Ok(SidebarData { projects: result })
}

fn query_project_repositories(
    db: &Connection,
    project_id: &str,
) -> rusqlite::Result<Vec<ProjectRepository>> {
    let mut statement = db.prepare(
        "SELECT id,project_id,name,source_root,git_common_dir,repository_url,preferred_remote_name,base_branch,delivery_mode,setup_command,setup_workdir,git_status,last_checked_at,created_at,updated_at FROM project_repositories WHERE project_id=? AND deleted_at IS NULL ORDER BY created_at,id",
    )?;
    let values = statement
        .query_map([project_id], project_repository_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(values)
}

fn query_project_directories(
    db: &Connection,
    project_id: &str,
) -> rusqlite::Result<Vec<ProjectDirectory>> {
    let mut statement = db.prepare(&format!(
        "SELECT {DIRECTORY_COLUMNS} FROM project_directories d LEFT JOIN project_repositories r ON r.id=d.repository_id WHERE d.project_id=? AND d.deleted_at IS NULL AND (r.id IS NULL OR r.deleted_at IS NULL) ORDER BY d.created_at,d.id"
    ))?;
    let values = statement
        .query_map([project_id], project_directory_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(values)
}

fn project_row(row: &Row<'_>) -> rusqlite::Result<Project> {
    let default_directory_id: Option<String> = row.get("default_directory_id")?;
    Ok(Project {
        id: row.get("id")?,
        name: row.get("name")?,
        description: row.get("description")?,
        status: row.get("status")?,
        default_location_id: default_directory_id.clone(),
        default_base_branch: "main".into(),
        default_delivery_mode: "remote_review".into(),
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        primary_directory_id: default_directory_id.unwrap_or_default(),
        git_common_dir: String::new(),
        preferred_remote: None,
        default_target_branch: "main".into(),
    })
}

fn project_repository_row(row: &Row<'_>) -> rusqlite::Result<ProjectRepository> {
    Ok(ProjectRepository {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        name: row.get("name")?,
        source_root: row.get("source_root")?,
        git_common_dir: row.get("git_common_dir")?,
        repository_url: row.get("repository_url")?,
        preferred_remote_name: row.get("preferred_remote_name")?,
        base_branch: row.get("base_branch")?,
        delivery_mode: row.get("delivery_mode")?,
        setup_command: row.get("setup_command")?,
        setup_workdir: row.get("setup_workdir")?,
        git_status: row.get("git_status")?,
        last_checked_at: row.get("last_checked_at")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn directory_row(row: &Row<'_>) -> rusqlite::Result<Directory> {
    let repository_id: Option<String> = row.get("repository_id")?;
    let relative_path: Option<String> = row.get("relative_path")?;
    let source_root: Option<String> = row.get("source_root")?;
    let external_path: Option<String> = row.get("external_path")?;
    let path = scope_path(
        source_root.as_deref(),
        relative_path.as_deref(),
        external_path.as_deref(),
    );
    let is_git = repository_id.is_some();
    Ok(Directory {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        name: row.get("name")?,
        description: row.get("description")?,
        worktree_setup_command: row
            .get::<_, Option<String>>("setup_command")?
            .unwrap_or_default(),
        path,
        repository_url: row.get("repository_url")?,
        preferred_remote_name: row.get("preferred_remote_name")?,
        base_branch: row.get("base_branch")?,
        delivery_mode: row.get("delivery_mode")?,
        git_common_dir: row.get("git_common_dir")?,
        git_status: if is_git {
            row.get::<_, Option<String>>("repository_status")?
                .unwrap_or_else(|| "missing".into())
        } else {
            row.get("status")?
        },
        last_checked_at: row.get("last_checked_at")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        checkout_path: source_root,
        role: "attached".into(),
        is_git,
        remote_url: row.get("repository_url")?,
        branch: None,
        head_commit: None,
        head_summary: None,
        dirty: false,
    })
}

fn project_directory_row(row: &Row<'_>) -> rusqlite::Result<ProjectDirectory> {
    let relative_path: Option<String> = row.get("relative_path")?;
    let external_path: Option<String> = row.get("external_path")?;
    let source_root: Option<String> = row.get("source_root")?;
    Ok(ProjectDirectory {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        repository_id: row.get("repository_id")?,
        name: row.get("name")?,
        description: row.get("description")?,
        relative_path: relative_path.clone(),
        external_path: external_path.clone(),
        path: scope_path(
            source_root.as_deref(),
            relative_path.as_deref(),
            external_path.as_deref(),
        ),
        status: row.get("status")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn scope_path(
    source_root: Option<&str>,
    relative_path: Option<&str>,
    external: Option<&str>,
) -> String {
    match (source_root, relative_path, external) {
        (Some(root), Some("."), _) => root.into(),
        (Some(root), Some(relative), _) => Path::new(root)
            .join(relative)
            .to_string_lossy()
            .into_owned(),
        (_, _, Some(path)) => path.into(),
        _ => String::new(),
    }
}

fn relative_scope(source_root: &str, selected: &str) -> Result<String> {
    let root = PathBuf::from(source_root);
    let selected = PathBuf::from(selected);
    let relative = selected.strip_prefix(&root).map_err(|_| {
        AppError::BadRequest("Directory must be inside the Repository source root".into())
    })?;
    if relative.as_os_str().is_empty() {
        Ok(".".into())
    } else {
        Ok(relative.to_string_lossy().replace('\\', "/"))
    }
}

fn normalized_path(path: &str) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| PathBuf::from(path))
}

fn basename(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("repository")
        .to_owned()
}
