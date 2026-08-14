use rusqlite::{named_params, params, Connection, OptionalExtension, Row};

use super::{now, Store};
use crate::{
    error::{AppError, Result},
    model::*,
};

impl Store {
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
            "INSERT INTO projects(id,name,description,status,default_location_id,default_base_branch,default_delivery_mode,created_at,updated_at)
             VALUES(:id,:name,:description,:status,:default_location_id,:default_base_branch,:default_delivery_mode,:created_at,:updated_at)",
            named_params! {
                ":id": p.id,
                ":name": p.name,
                ":description": p.description,
                ":status": p.status,
                ":default_location_id": p.default_location_id,
                ":default_base_branch": p.default_base_branch,
                ":default_delivery_mode": p.default_delivery_mode,
                ":created_at": p.created_at,
                ":updated_at": p.updated_at,
            },
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
            return Err(crate::error::AppError::NotFound);
        }
        Ok(())
    }

    pub fn directories(&self, project_id: &str) -> Result<Vec<Directory>> {
        let db = self.0.lock();
        let mut stmt = db.prepare(
            "SELECT pl.id,pl.project_id,pl.name,pl.description,pl.worktree_setup_command,pl.path,pl.repository_url,pl.preferred_remote_name,pl.base_branch,pl.delivery_mode,pl.git_common_dir,pl.created_at,pl.updated_at
             FROM project_locations pl
             JOIN projects p ON p.id=pl.project_id
             WHERE pl.project_id=?
             ORDER BY CASE WHEN pl.id=p.default_location_id THEN 0 ELSE 1 END,
                      pl.created_at ASC,
                      pl.rowid ASC",
        )?;
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
        let mut db = self.0.lock();
        let tx = db.transaction()?;
        tx.execute(
            "DELETE FROM workspace_locations
             WHERE project_location_id=?
               AND workspace_id IN (SELECT id FROM workspaces WHERE kind='base')",
            [id],
        )?;
        let referenced: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM workspace_locations WHERE project_location_id=?) AS referenced",
            [id],
            |r| r.get("referenced"),
        )?;
        if referenced {
            return Err(AppError::BadRequest(
                "location is snapshotted by an existing Workspace".into(),
            ));
        }
        let changed = tx.execute("DELETE FROM project_locations WHERE id=?", [id])?;
        if changed == 0 {
            return Err(AppError::NotFound);
        }
        tx.commit()?;
        Ok(())
    }

    pub fn project_detail(&self, id: &str) -> Result<ProjectDetail> {
        let locations = self.directories(id)?;
        Ok(ProjectDetail {
            project: self.project(id)?,
            locations,
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

fn project_row(r: &Row<'_>) -> rusqlite::Result<Project> {
    let default_location_id: Option<String> = r.get("default_location_id")?;
    let default_base_branch: String = r.get("default_base_branch")?;
    Ok(Project {
        id: r.get("id")?,
        name: r.get("name")?,
        description: r.get("description")?,
        status: r.get("status")?,
        default_location_id: default_location_id.clone(),
        default_base_branch: default_base_branch.clone(),
        default_delivery_mode: r.get("default_delivery_mode")?,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
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
        "SELECT git_common_dir,preferred_remote_name,COALESCE(base_branch,?) AS base_branch,COALESCE(delivery_mode,?) AS delivery_mode FROM project_locations WHERE id=?",
        params![project.default_base_branch, project.default_delivery_mode, location_id],
        |r| Ok((r.get::<_, Option<String>>("git_common_dir")?, r.get::<_, Option<String>>("preferred_remote_name")?, r.get::<_, String>("base_branch")?, r.get::<_, String>("delivery_mode")?)),
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
    let git_common_dir: Option<String> = r.get("git_common_dir")?;
    let is_git = git_common_dir.is_some();
    Ok(Directory {
        id: r.get("id")?,
        project_id: r.get("project_id")?,
        name: r.get("name")?,
        description: r.get("description")?,
        worktree_setup_command: r.get("worktree_setup_command")?,
        path: r.get("path")?,
        repository_url: r.get("repository_url")?,
        preferred_remote_name: r.get("preferred_remote_name")?,
        base_branch: r.get("base_branch")?,
        delivery_mode: r.get("delivery_mode")?,
        git_common_dir,
        git_status: if is_git {
            "ready".into()
        } else {
            "not_git".into()
        },
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
        checkout_path: None,
        role: "attached".into(),
        is_git,
        remote_url: r.get("repository_url")?,
        branch: None,
        head_commit: None,
        head_summary: None,
        dirty: false,
    })
}

fn insert_project_location(
    tx: &rusqlite::Transaction<'_>,
    d: &ProjectLocation,
) -> rusqlite::Result<()> {
    tx.execute(
        "INSERT INTO project_locations(id,project_id,name,description,worktree_setup_command,path,repository_url,preferred_remote_name,base_branch,delivery_mode,git_common_dir,created_at,updated_at)
         VALUES(:id,:project_id,:name,:description,:worktree_setup_command,:path,:repository_url,:preferred_remote_name,:base_branch,:delivery_mode,:git_common_dir,:created_at,:updated_at)",
        named_params! {
            ":id": d.id,
            ":project_id": d.project_id,
            ":name": d.name,
            ":description": d.description,
            ":worktree_setup_command": d.worktree_setup_command,
            ":path": d.path,
            ":repository_url": d.repository_url,
            ":preferred_remote_name": d.preferred_remote_name,
            ":base_branch": d.base_branch,
            ":delivery_mode": d.delivery_mode,
            ":git_common_dir": d.git_common_dir,
            ":created_at": d.created_at,
            ":updated_at": d.updated_at,
        },
    )?;
    Ok(())
}
