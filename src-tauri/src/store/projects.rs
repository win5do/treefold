use rusqlite::{named_params, params, Connection, OptionalExtension, Row};

use super::{now, Store};
use super::{
    sessions::{session_row, SESSION_COLUMNS},
    workspaces::{
        hydrate_workspace_compat, workspace_location_row, workspace_row, WORKSPACE_COLUMNS,
        WORKSPACE_LOCATION_COLUMNS,
    },
};
use crate::{
    error::{AppError, Result},
    model::*,
};

impl Store {
    pub async fn project_summaries_async(&self) -> Result<Vec<ProjectSummary>> {
        Ok(self.1.conn_and_then(project_summaries_on).await?)
    }

    pub async fn sidebar_async(&self) -> Result<SidebarData> {
        Ok(self.1.conn_and_then(sidebar_on).await?)
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
            "SELECT pl.id,pl.project_id,pl.name,pl.description,pl.worktree_setup_command,pl.path,pl.repository_url,pl.preferred_remote_name,pl.base_branch,pl.delivery_mode,pl.git_common_dir,pl.git_status,pl.last_checked_at,pl.created_at,pl.updated_at
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
        Ok(db.query_row("SELECT id,project_id,name,description,worktree_setup_command,path,repository_url,preferred_remote_name,base_branch,delivery_mode,git_common_dir,git_status,last_checked_at,created_at,updated_at FROM project_locations WHERE id=?", [id], directory_row)?)
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
            "UPDATE project_locations SET path=?,name=?,repository_url=?,preferred_remote_name=?,base_branch=?,delivery_mode=?,git_common_dir=?,git_status=?,last_checked_at=?,updated_at=? WHERE id=?",
            params![location.path,location.name,location.repository_url,location.preferred_remote_name,location.base_branch,location.delivery_mode,location.git_common_dir,location.git_status,location.last_checked_at,location.updated_at,location.id],
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
            "UPDATE project_locations SET path=?,git_common_dir=?,repository_url=?,preferred_remote_name=?,git_status='ready',last_checked_at=?,updated_at=? WHERE id=?",
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

fn project_summaries_on(db: &Connection) -> Result<Vec<ProjectSummary>> {
    let mut statement = db.prepare(
        "SELECT p.id,p.name,p.description,p.status,p.updated_at,
                COUNT(DISTINCT pl.id),
                COUNT(DISTINCT CASE WHEN pl.git_common_dir IS NOT NULL THEN pl.id END),
                COUNT(DISTINCT CASE WHEN pl.git_common_dir IS NULL THEN pl.id END),
                COUNT(DISTINCT CASE WHEN pl.git_status='missing' THEN pl.id END),
                COUNT(DISTINCT CASE WHEN pl.git_status NOT IN ('ready','not_git','missing') THEN pl.id END),
                COUNT(DISTINCT CASE WHEN w.status='active' AND w.kind='workspace' THEN w.id END)
         FROM projects p
         LEFT JOIN project_locations pl ON pl.project_id=p.id
         LEFT JOIN workspaces w ON w.project_id=p.id
         GROUP BY p.id ORDER BY p.updated_at DESC",
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
    let mut project_statement = transaction.prepare(
        "SELECT id,name,description,status,default_location_id,default_base_branch,default_delivery_mode,created_at,updated_at
         FROM projects WHERE status='active' ORDER BY updated_at DESC",
    )?;
    let mut projects = project_statement
        .query_map([], project_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(project_statement);
    let mut values = Vec::with_capacity(projects.len());
    for mut project in projects.drain(..) {
        hydrate_project_compat(&transaction, &mut project)?;
        let mut location_statement = transaction.prepare(
            "SELECT pl.id,pl.project_id,pl.name,pl.description,pl.worktree_setup_command,pl.path,pl.repository_url,pl.preferred_remote_name,pl.base_branch,pl.delivery_mode,pl.git_common_dir,pl.git_status,pl.last_checked_at,pl.created_at,pl.updated_at
             FROM project_locations pl WHERE pl.project_id=? ORDER BY pl.created_at,pl.rowid",
        )?;
        let locations = location_statement
            .query_map([&project.id], directory_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        let aliased_session_columns = format!("s.{}", SESSION_COLUMNS.replace(',', ",s."));
        let mut project_sessions_statement = transaction.prepare(&format!(
            "SELECT {aliased_session_columns} FROM sessions s JOIN workspaces w ON w.id=s.workspace_id
             WHERE w.project_id=? AND w.kind='base' AND s.visibility='visible'
             ORDER BY s.sort_order,s.created_at DESC"
        ))?;
        let sessions = project_sessions_statement
            .query_map([&project.id], session_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        let mut workspace_statement = transaction.prepare(&format!(
            "SELECT {WORKSPACE_COLUMNS} FROM workspaces
             WHERE project_id=? AND status='active' AND kind!='base' ORDER BY updated_at DESC"
        ))?;
        let mut workspaces = workspace_statement
            .query_map([&project.id], workspace_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut sidebar_workspaces = Vec::with_capacity(workspaces.len());
        for mut workspace in workspaces.drain(..) {
            hydrate_workspace_compat(&transaction, &mut workspace)?;
            let mut sessions_statement = transaction.prepare(&format!(
                "SELECT {SESSION_COLUMNS} FROM sessions WHERE workspace_id=? AND visibility='visible'
                 ORDER BY sort_order,created_at DESC"
            ))?;
            let sessions = sessions_statement
                .query_map([&workspace.id], session_row)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            let mut locations_statement = transaction.prepare(&format!(
                "SELECT {WORKSPACE_LOCATION_COLUMNS} FROM workspace_locations WHERE workspace_id=? ORDER BY location_name"
            ))?;
            let locations = locations_statement
                .query_map([&workspace.id], workspace_location_row)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            sidebar_workspaces.push(SidebarWorkspace {
                workspace,
                sessions,
                locations,
            });
        }
        values.push(SidebarProject {
            project,
            locations,
            sessions,
            workspaces: sidebar_workspaces,
        });
    }
    drop(transaction);
    Ok(SidebarData { projects: values })
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
        git_status: r.get("git_status")?,
        last_checked_at: r.get("last_checked_at")?,
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
        "INSERT INTO project_locations(id,project_id,name,description,worktree_setup_command,path,repository_url,preferred_remote_name,base_branch,delivery_mode,git_common_dir,git_status,last_checked_at,created_at,updated_at)
         VALUES(:id,:project_id,:name,:description,:worktree_setup_command,:path,:repository_url,:preferred_remote_name,:base_branch,:delivery_mode,:git_common_dir,:git_status,:last_checked_at,:created_at,:updated_at)",
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
            ":git_status": d.git_status,
            ":last_checked_at": d.last_checked_at,
            ":created_at": d.created_at,
            ":updated_at": d.updated_at,
        },
    )?;
    Ok(())
}
