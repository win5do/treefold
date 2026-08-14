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
                &format!(
                    "SELECT {WORKSPACE_COLUMNS} FROM workspaces WHERE project_id=? AND kind='base' LIMIT 1"
                ),
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
        locations: &[WorkspaceLocation],
    ) -> Result<()> {
        let mut db = self.0.lock();
        let tx = db.transaction()?;
        tx.execute(
            "INSERT INTO workspaces(id,project_id,name,description,status,kind,parent_workspace_id,runtime_id,runtime_name,created_at,updated_at)
             VALUES(:id,:project_id,:name,:description,:status,'base',NULL,:runtime_id,:runtime_name,:created_at,:updated_at)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name,status=excluded.status,updated_at=excluded.updated_at",
            named_params! {
                ":id": workspace.id,
                ":project_id": workspace.project_id,
                ":name": workspace.name,
                ":description": workspace.description,
                ":status": workspace.status,
                ":runtime_id": workspace.runtime_id,
                ":runtime_name": workspace.runtime_name,
                ":created_at": workspace.created_at,
                ":updated_at": workspace.updated_at,
            },
        )?;
        tx.execute(
            "DELETE FROM workspace_locations WHERE workspace_id=?",
            [&workspace.id],
        )?;
        for location in locations {
            insert_workspace_location(&tx, location)?;
        }
        tx.commit()?;
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
        tx.execute(
            "INSERT INTO workspaces(id,project_id,name,description,status,kind,parent_workspace_id,runtime_id,runtime_name,created_at,updated_at)
             VALUES(:id,:project_id,:name,:description,:status,:kind,:parent_workspace_id,:runtime_id,:runtime_name,:created_at,:updated_at)",
            named_params! {
                ":id": w.id,
                ":project_id": w.project_id,
                ":name": w.name,
                ":description": w.description,
                ":status": w.status,
                ":kind": w.kind,
                ":parent_workspace_id": w.parent_workspace_id,
                ":runtime_id": w.runtime_id,
                ":runtime_name": w.runtime_name,
                ":created_at": w.created_at,
                ":updated_at": w.updated_at,
            },
        )?;
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
            "UPDATE workspace_locations SET git_status=?,checkout_path=?,start_commit=?,creation_error=?,delivery_status=?,updated_at=? WHERE id=?",
            params![git_status, checkout_path, start_commit, creation_error, delivery_status, now(), id],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }

    pub fn set_workspace_location_creation_error(&self, id: &str, error: &str) -> Result<()> {
        let changed = self.0.lock().execute(
            "UPDATE workspace_locations SET creation_error=?,updated_at=? WHERE id=?",
            params![error, now(), id],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
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
        Ok(db.query_row(&format!("SELECT {WORKSPACE_LOCATION_JOIN_COLUMNS} FROM workspace_locations wl JOIN workspaces w ON w.id=wl.workspace_id JOIN projects p ON p.id=w.project_id WHERE wl.workspace_id=? ORDER BY wl.git_status='ready' DESC,wl.project_location_id=p.default_location_id DESC LIMIT 1"), [workspace_id], workspace_location_row)?)
    }

    pub(super) fn resolve_workspace_location_id(
        &self,
        workspace_or_location_id: &str,
    ) -> Result<String> {
        let db = self.0.lock();
        if let Some(id) = db
            .query_row(
                "SELECT id FROM workspace_locations WHERE id=?",
                [workspace_or_location_id],
                |r| r.get("id"),
            )
            .optional()?
        {
            return Ok(id);
        }
        Ok(db.query_row("SELECT wl.id AS id FROM workspace_locations wl JOIN workspaces w ON w.id=wl.workspace_id JOIN projects p ON p.id=w.project_id WHERE wl.workspace_id=? ORDER BY wl.git_status='ready' DESC,wl.project_location_id=p.default_location_id DESC LIMIT 1", [workspace_or_location_id], |r| r.get("id"))?)
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
            "SELECT EXISTS(SELECT 1 FROM workspace_locations WHERE workspace_id=? AND access_mode='read_write' AND delivery_status NOT IN ('delivered','kept','discarded','remote_merged')) AS unfinished",
            [id], |r| r.get("unfinished"),
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

const WORKSPACE_COLUMNS: &str = "id,project_id,name,description,status,kind,parent_workspace_id,runtime_id,runtime_name,created_at,updated_at";
fn workspace_row(r: &Row<'_>) -> rusqlite::Result<Workspace> {
    Ok(Workspace {
        id: r.get("id")?,
        project_id: r.get("project_id")?,
        name: r.get("name")?,
        description: r.get("description")?,
        status: r.get("status")?,
        kind: r.get("kind")?,
        parent_workspace_id: r.get("parent_workspace_id")?,
        runtime_id: r.get("runtime_id")?,
        runtime_name: r.get("runtime_name")?,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
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

const WORKSPACE_LOCATION_COLUMNS: &str = "id,workspace_id,project_location_id,location_name,source_path,access_mode,git_status,creation_error,worktree_id,checkout_path,branch,base_branch,start_commit,forked_from_commit,remote_name,remote_branch,branch_ownership,delivery_mode,delivery_status,close_outcome,integrated_commit,closed_at,created_at,updated_at";
const WORKSPACE_LOCATION_JOIN_COLUMNS: &str = "wl.id,wl.workspace_id,wl.project_location_id,wl.location_name,wl.source_path,wl.access_mode,wl.git_status,wl.creation_error,wl.worktree_id,wl.checkout_path,wl.branch,wl.base_branch,wl.start_commit,wl.forked_from_commit,wl.remote_name,wl.remote_branch,wl.branch_ownership,wl.delivery_mode,wl.delivery_status,wl.close_outcome,wl.integrated_commit,wl.closed_at,wl.created_at,wl.updated_at";

fn workspace_location_row(r: &Row<'_>) -> rusqlite::Result<WorkspaceLocation> {
    Ok(WorkspaceLocation {
        id: r.get("id")?,
        workspace_id: r.get("workspace_id")?,
        project_location_id: r.get("project_location_id")?,
        location_name: r.get("location_name")?,
        source_path: r.get("source_path")?,
        access_mode: r.get("access_mode")?,
        git_status: r.get("git_status")?,
        creation_error: r.get("creation_error")?,
        worktree_id: r.get("worktree_id")?,
        checkout_path: r.get("checkout_path")?,
        branch: r.get("branch")?,
        base_branch: r.get("base_branch")?,
        start_commit: r.get("start_commit")?,
        forked_from_commit: r.get("forked_from_commit")?,
        remote_name: r.get("remote_name")?,
        remote_branch: r.get("remote_branch")?,
        branch_ownership: r.get("branch_ownership")?,
        delivery_mode: r.get("delivery_mode")?,
        delivery_status: r.get("delivery_status")?,
        close_outcome: r.get("close_outcome")?,
        integrated_commit: r.get("integrated_commit")?,
        closed_at: r.get("closed_at")?,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
    })
}

fn hydrate_workspace_compat(db: &Connection, workspace: &mut Workspace) -> rusqlite::Result<()> {
    if workspace.kind == "base" {
        workspace.checkout_mode = "in_place".into();
        workspace.branch_ownership = "user".into();
    }
    let location = db.query_row(
        &format!("SELECT {WORKSPACE_LOCATION_JOIN_COLUMNS} FROM workspace_locations wl JOIN projects p ON p.id=? WHERE wl.workspace_id=? ORDER BY wl.git_status='ready' DESC,wl.project_location_id=p.default_location_id DESC LIMIT 1"),
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
    if workspace.kind == "base" {
        workspace.checkout_mode = "in_place".into();
        workspace.branch_ownership = "user".into();
        workspace.delivery_status = "not_applicable".into();
    }
    Ok(())
}

fn insert_workspace_location(
    tx: &rusqlite::Transaction<'_>,
    l: &WorkspaceLocation,
) -> rusqlite::Result<()> {
    tx.execute(
        &format!("INSERT INTO workspace_locations({WORKSPACE_LOCATION_COLUMNS}) VALUES(:id,:workspace_id,:project_location_id,:location_name,:source_path,:access_mode,:git_status,:creation_error,:worktree_id,:checkout_path,:branch,:base_branch,:start_commit,:forked_from_commit,:remote_name,:remote_branch,:branch_ownership,:delivery_mode,:delivery_status,:close_outcome,:integrated_commit,:closed_at,:created_at,:updated_at)"),
        named_params! {
            ":id": l.id,
            ":workspace_id": l.workspace_id,
            ":project_location_id": l.project_location_id,
            ":location_name": l.location_name,
            ":source_path": l.source_path,
            ":access_mode": l.access_mode,
            ":git_status": l.git_status,
            ":creation_error": l.creation_error,
            ":worktree_id": l.worktree_id,
            ":checkout_path": l.checkout_path,
            ":branch": l.branch,
            ":base_branch": l.base_branch,
            ":start_commit": l.start_commit,
            ":forked_from_commit": l.forked_from_commit,
            ":remote_name": l.remote_name,
            ":remote_branch": l.remote_branch,
            ":branch_ownership": l.branch_ownership,
            ":delivery_mode": l.delivery_mode,
            ":delivery_status": l.delivery_status,
            ":close_outcome": l.close_outcome,
            ":integrated_commit": l.integrated_commit,
            ":closed_at": l.closed_at,
            ":created_at": l.created_at,
            ":updated_at": l.updated_at,
        },
    )?;
    Ok(())
}
