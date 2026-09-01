#![allow(dead_code)]
use super::{Store, now};
use crate::{
    error::{AppError, Result},
    model::*,
};
use sqlx::{Sqlite, Transaction};
use std::path::Path;
const W: &str = "id,project_id,name,description,status,kind,parent_workspace_id,runtime_id,runtime_name,created_at,updated_at";
const WR: &str = "id,workspace_id,project_repository_id,repository_name,source_root,'read_write' AS access_mode,git_status,creation_error,worktree_id,checkout_path,branch,base_branch,start_commit,forked_from_commit,remote_name,remote_branch,branch_ownership,delivery_mode,delivery_status,close_outcome,integrated_commit,closed_at,created_at,updated_at";
const WD: &str = "wd.id,wd.workspace_id,wd.project_directory_id,wd.workspace_repository_id,wd.name,wd.description,wd.relative_path,wd.external_path,wd.access_mode,wd.status,wd.created_at,wd.updated_at,wr.checkout_path,wr.source_root,(SELECT kind FROM workspaces WHERE id=wd.workspace_id) AS workspace_kind";
#[derive(sqlx::FromRow)]
struct WorkspaceRow {
    id: String,
    project_id: String,
    name: String,
    description: String,
    status: String,
    kind: String,
    parent_workspace_id: Option<String>,
    runtime_id: String,
    runtime_name: String,
    created_at: String,
    updated_at: String,
}
impl From<WorkspaceRow> for Workspace {
    fn from(r: WorkspaceRow) -> Self {
        Self {
            id: r.id,
            project_id: r.project_id,
            name: r.name,
            description: r.description,
            status: r.status,
            kind: r.kind,
            parent_workspace_id: r.parent_workspace_id,
            runtime_id: r.runtime_id,
            runtime_name: r.runtime_name,
            created_at: r.created_at,
            updated_at: r.updated_at,
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
            delivery_mode: "push_branch".into(),
            delivery_status: "active".into(),
            close_outcome: None,
            integrated_commit: None,
            closed_at: None,
        }
    }
}
#[derive(sqlx::FromRow)]
struct WorkspaceDirectoryRow {
    id: String,
    workspace_id: String,
    project_directory_id: String,
    workspace_repository_id: Option<String>,
    name: String,
    description: String,
    relative_path: Option<String>,
    external_path: Option<String>,
    access_mode: String,
    status: String,
    created_at: String,
    updated_at: String,
    checkout_path: Option<String>,
    source_root: Option<String>,
    workspace_kind: String,
}
impl From<WorkspaceDirectoryRow> for WorkspaceDirectory {
    fn from(r: WorkspaceDirectoryRow) -> Self {
        let root = if r.workspace_kind == "base" {
            r.source_root.as_deref()
        } else {
            r.checkout_path.as_deref()
        };
        let path = match (root, r.relative_path.as_deref(), r.external_path.as_deref()) {
            (Some(root), Some("."), _) => root.into(),
            (Some(root), Some(rel), _) => Path::new(root).join(rel).to_string_lossy().into_owned(),
            (_, _, Some(path)) => path.into(),
            _ => String::new(),
        };
        Self {
            id: r.id,
            workspace_id: r.workspace_id,
            project_directory_id: r.project_directory_id,
            workspace_repository_id: r.workspace_repository_id,
            name: r.name,
            description: r.description,
            relative_path: r.relative_path,
            external_path: r.external_path,
            path,
            access_mode: r.access_mode,
            status: r.status,
            created_at: r.created_at,
            updated_at: r.updated_at,
        }
    }
}
impl Store {
    async fn raw_workspaces(&self, sql: impl sqlx::SqlSafeStr, id: &str) -> Result<Vec<Workspace>> {
        Ok(sqlx::query_as::<_, WorkspaceRow>(sql)
            .bind(id)
            .fetch_all(&self.pool)
            .await?
            .into_iter()
            .map(Into::into)
            .collect())
    }
    async fn hydrate(&self, w: &mut Workspace) -> Result<()> {
        if w.kind == "base" {
            w.checkout_mode = "in_place".into();
            w.branch_ownership = "user".into()
        }
        let r:Option<WorkspaceRepository>=sqlx::query_as(static_sql!("SELECT {WR} FROM workspace_repositories WHERE workspace_id=? ORDER BY git_status='ready' DESC,project_repository_id=(SELECT d.repository_id FROM workspaces w JOIN projects p ON p.id=w.project_id LEFT JOIN project_directories d ON d.id=p.default_directory_id WHERE w.id=workspace_repositories.workspace_id) DESC LIMIT 1")).bind(&w.id).fetch_optional(&self.pool).await?;
        if let Some(r) = r {
            w.project_directory_id = sqlx::query_scalar::<_, Option<String>>(
                "SELECT default_directory_id FROM projects WHERE id=?",
            )
            .bind(&w.project_id)
            .fetch_optional(&self.pool)
            .await?
            .flatten()
            .unwrap_or_default();
            w.worktree_id = r.worktree_id;
            w.checkout_path = r.checkout_path.unwrap_or_else(|| r.source_root.clone());
            w.target_branch = r.base_branch.unwrap_or_default();
            w.start_commit = r.start_commit.unwrap_or_default();
            w.branch = r.branch.unwrap_or_default();
            w.forked_from_commit = r.forked_from_commit;
            w.remote_name = r.remote_name;
            w.remote_branch = r.remote_branch;
            w.branch_ownership = r.branch_ownership;
            w.delivery_mode = r.delivery_mode;
            w.delivery_status = r.delivery_status;
            w.close_outcome = r.close_outcome;
            w.integrated_commit = r.integrated_commit;
            w.closed_at = r.closed_at
        }
        if w.kind == "base" {
            w.checkout_mode = "in_place".into();
            w.branch_ownership = "user".into();
            w.delivery_status = "not_applicable".into()
        }
        Ok(())
    }
    pub async fn project_session_workspace(&self, id: &str) -> Result<Option<Workspace>> {
        let r: Option<WorkspaceRow> = sqlx::query_as(static_sql!(
            "SELECT {W} FROM workspaces WHERE project_id=? AND kind='base' LIMIT 1"
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        let mut w = r.map(Into::into);
        if let Some(w) = &mut w {
            self.hydrate(w).await?
        }
        Ok(w)
    }
    pub async fn workspaces(&self, id: &str) -> Result<Vec<Workspace>> {
        let mut v = self
            .raw_workspaces(
                static_sql!(
                    "SELECT {W} FROM workspaces WHERE project_id=? ORDER BY updated_at DESC"
                ),
                id,
            )
            .await?;
        for w in &mut v {
            self.hydrate(w).await?
        }
        Ok(v)
    }
    pub async fn workspace(&self, id: &str) -> Result<Workspace> {
        let r: WorkspaceRow = sqlx::query_as(static_sql!("SELECT {W} FROM workspaces WHERE id=?"))
            .bind(id)
            .fetch_one(&self.pool)
            .await?;
        let mut w = r.into();
        self.hydrate(&mut w).await?;
        Ok(w)
    }
    async fn insert_workspace(
        tx: &mut Transaction<'_, Sqlite>,
        w: &Workspace,
        kind: Option<&str>,
    ) -> Result<()> {
        sqlx::query("INSERT INTO workspaces(id,project_id,name,description,status,kind,parent_workspace_id,runtime_id,runtime_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(&w.id).bind(&w.project_id).bind(&w.name).bind(&w.description).bind(&w.status).bind(kind.unwrap_or(&w.kind)).bind(&w.parent_workspace_id).bind(&w.runtime_id).bind(&w.runtime_name).bind(&w.created_at).bind(&w.updated_at).execute(&mut **tx).await?;
        Ok(())
    }
    async fn insert_repositories(
        tx: &mut Transaction<'_, Sqlite>,
        w: &Workspace,
        values: &[WorkspaceRepository],
    ) -> Result<()> {
        for v in values {
            let repo: Option<String> = sqlx::query_scalar(
                "SELECT repository_id FROM project_directories WHERE id=? AND deleted_at IS NULL",
            )
            .bind(&v.project_repository_id)
            .fetch_optional(&mut **tx)
            .await?
            .flatten();
            let repo = if repo.is_some() {
                repo
            } else {
                sqlx::query_scalar(
                    "SELECT id FROM project_repositories WHERE id=? AND deleted_at IS NULL",
                )
                .bind(&v.project_repository_id)
                .fetch_optional(&mut **tx)
                .await?
            };
            let Some(repo) = repo else { continue };
            let(name,root):(String,String)=sqlx::query_as("SELECT name,source_root FROM project_repositories WHERE id=? AND deleted_at IS NULL").bind(&repo).fetch_one(&mut **tx).await?;
            sqlx::query("INSERT OR IGNORE INTO workspace_repositories(id,workspace_id,project_repository_id,repository_name,source_root,git_status,creation_error,worktree_id,checkout_path,branch,base_branch,start_commit,forked_from_commit,remote_name,remote_branch,branch_ownership,delivery_mode,delivery_status,close_outcome,integrated_commit,closed_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(&v.id).bind(&w.id).bind(repo).bind(name).bind(root).bind(&v.git_status).bind(&v.creation_error).bind(&v.worktree_id).bind(&v.checkout_path).bind(&v.branch).bind(&v.base_branch).bind(&v.start_commit).bind(&v.forked_from_commit).bind(&v.remote_name).bind(&v.remote_branch).bind(&v.branch_ownership).bind(&v.delivery_mode).bind(&v.delivery_status).bind(&v.close_outcome).bind(&v.integrated_commit).bind(&v.closed_at).bind(&v.created_at).bind(&v.updated_at).execute(&mut **tx).await?;
        }
        Ok(())
    }
    async fn snapshot(tx: &mut Transaction<'_, Sqlite>, w: &Workspace) -> Result<()> {
        sqlx::query("INSERT INTO workspace_directories(id,workspace_id,project_directory_id,workspace_repository_id,name,description,relative_path,external_path,access_mode,status,created_at,updated_at) SELECT ? || '-' || d.id,?,d.id,wr.id,d.name,d.description,d.relative_path,d.external_path,CASE WHEN d.repository_id IS NULL THEN 'read_only' ELSE 'read_write' END,d.status,?,? FROM project_directories d LEFT JOIN workspace_repositories wr ON wr.workspace_id=? AND wr.project_repository_id=d.repository_id LEFT JOIN project_repositories r ON r.id=d.repository_id WHERE d.project_id=? AND d.deleted_at IS NULL AND (r.id IS NULL OR r.deleted_at IS NULL)").bind(&w.id).bind(&w.id).bind(&w.created_at).bind(&w.updated_at).bind(&w.id).bind(&w.project_id).execute(&mut **tx).await?;
        Ok(())
    }
    pub async fn create_workspace_with_repositories(
        &self,
        w: &Workspace,
        repos: &[WorkspaceRepository],
    ) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        Self::insert_workspace(&mut tx, w, None).await?;
        Self::insert_repositories(&mut tx, w, repos).await?;
        Self::snapshot(&mut tx, w).await?;
        tx.commit().await?;
        Ok(())
    }
    pub async fn sync_project_session_workspace(
        &self,
        w: &Workspace,
        repos: &[WorkspaceRepository],
    ) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("INSERT INTO workspaces(id,project_id,name,description,status,kind,parent_workspace_id,runtime_id,runtime_name,created_at,updated_at) VALUES(?,?,?,?,?,'base',NULL,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,status=excluded.status,updated_at=excluded.updated_at").bind(&w.id).bind(&w.project_id).bind(&w.name).bind(&w.description).bind(&w.status).bind(&w.runtime_id).bind(&w.runtime_name).bind(&w.created_at).bind(&w.updated_at).execute(&mut *tx).await?;
        sqlx::query("DELETE FROM workspace_directories WHERE workspace_id=?")
            .bind(&w.id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM workspace_repositories WHERE workspace_id=?")
            .bind(&w.id)
            .execute(&mut *tx)
            .await?;
        Self::insert_repositories(&mut tx, w, repos).await?;
        Self::snapshot(&mut tx, w).await?;
        tx.commit().await?;
        Ok(())
    }
    pub async fn rename_workspace(&self, id: &str, name: &str, description: &str) -> Result<()> {
        let r = sqlx::query("UPDATE workspaces SET name=?,description=?,updated_at=? WHERE id=?")
            .bind(name)
            .bind(description)
            .bind(now())
            .bind(id)
            .execute(&self.pool)
            .await?;
        if r.rows_affected() == 0 {
            Err(AppError::NotFound)
        } else {
            Ok(())
        }
    }
    pub async fn delete_workspace(&self, id: &str) -> Result<()> {
        let r = sqlx::query("DELETE FROM workspaces WHERE id=?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        if r.rows_affected() == 0 {
            Err(AppError::NotFound)
        } else {
            Ok(())
        }
    }
    pub async fn workspace_repositories(&self, id: &str) -> Result<Vec<WorkspaceRepository>> {
        Ok(sqlx::query_as(static_sql!(
            "SELECT {WR} FROM workspace_repositories WHERE workspace_id=? ORDER BY repository_name"
        ))
        .bind(id)
        .fetch_all(&self.pool)
        .await?)
    }
    pub async fn workspace_directories(&self, id: &str) -> Result<Vec<WorkspaceDirectory>> {
        Ok(sqlx::query_as::<_,WorkspaceDirectoryRow>(static_sql!("SELECT {WD} FROM workspace_directories wd LEFT JOIN workspace_repositories wr ON wr.id=wd.workspace_repository_id WHERE wd.workspace_id=? ORDER BY wd.name,wd.id")).bind(id).fetch_all(&self.pool).await?.into_iter().map(Into::into).collect())
    }
    pub async fn workspace_repository(&self, id: &str) -> Result<WorkspaceRepository> {
        Ok(sqlx::query_as(static_sql!(
            "SELECT {WR} FROM workspace_repositories WHERE id=?"
        ))
        .bind(id)
        .fetch_one(&self.pool)
        .await?)
    }
    pub async fn set_workspace_repository_creation_result(
        &self,
        id: &str,
        status: &str,
        checkout: Option<&str>,
        start: Option<&str>,
        error: Option<&str>,
    ) -> Result<()> {
        let delivery = if status == "failed" {
            "discarded"
        } else {
            "active"
        };
        let r=sqlx::query("UPDATE workspace_repositories SET git_status=?,checkout_path=?,start_commit=?,creation_error=?,delivery_status=?,updated_at=? WHERE id=?").bind(status).bind(checkout).bind(start).bind(error).bind(delivery).bind(now()).bind(id).execute(&self.pool).await?;
        if r.rows_affected() == 0 {
            Err(AppError::NotFound)
        } else {
            Ok(())
        }
    }
    pub async fn set_workspace_repository_creation_error(
        &self,
        id: &str,
        error: &str,
    ) -> Result<()> {
        let r = sqlx::query(
            "UPDATE workspace_repositories SET creation_error=?,updated_at=? WHERE id=?",
        )
        .bind(error)
        .bind(now())
        .bind(id)
        .execute(&self.pool)
        .await?;
        if r.rows_affected() == 0 {
            Err(AppError::NotFound)
        } else {
            Ok(())
        }
    }
    pub async fn workspace_repositories_for_project_repository(
        &self,
        id: &str,
    ) -> Result<Vec<WorkspaceRepository>> {
        let repo: Option<String> = sqlx::query_scalar(
            "SELECT repository_id FROM project_directories WHERE id=? AND deleted_at IS NULL",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .flatten();
        let repo = repo.unwrap_or_else(|| id.to_owned());
        Ok(sqlx::query_as(static_sql!("SELECT {WR} FROM workspace_repositories WHERE project_repository_id=? AND workspace_id IN (SELECT id FROM workspaces WHERE status='active') ORDER BY created_at")).bind(repo).fetch_all(&self.pool).await?)
    }
    pub async fn default_workspace_repository(&self, id: &str) -> Result<WorkspaceRepository> {
        Ok(sqlx::query_as(static_sql!("SELECT {WR} FROM workspace_repositories WHERE workspace_id=? ORDER BY git_status='ready' DESC,project_repository_id=(SELECT d.repository_id FROM workspaces w JOIN projects p ON p.id=w.project_id LEFT JOIN project_directories d ON d.id=p.default_directory_id WHERE w.id=workspace_repositories.workspace_id) DESC LIMIT 1")).bind(id).fetch_one(&self.pool).await?)
    }
    pub(super) async fn resolve_workspace_repository_id(&self, id: &str) -> Result<String> {
        if let Some(r) = sqlx::query_scalar("SELECT id FROM workspace_repositories WHERE id=?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?
        {
            return Ok(r);
        }
        Ok(sqlx::query_scalar("SELECT wr.id FROM workspace_repositories wr JOIN workspaces w ON w.id=wr.workspace_id JOIN projects p ON p.id=w.project_id LEFT JOIN project_directories d ON d.id=p.default_directory_id WHERE wr.workspace_id=? ORDER BY wr.git_status='ready' DESC,wr.project_repository_id=d.repository_id DESC LIMIT 1").bind(id).fetch_one(&self.pool).await?)
    }
    pub(crate) async fn forks(&self, id: &str) -> Result<Vec<Workspace>> {
        self.raw_workspaces(
            static_sql!(
                "SELECT {W} FROM workspaces WHERE parent_workspace_id=? ORDER BY updated_at DESC"
            ),
            id,
        )
        .await
    }
    pub async fn finish_workspace(
        &self,
        id: &str,
        status: &str,
        outcome: &str,
        commit: Option<&str>,
        t: &str,
    ) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("UPDATE workspace_repositories SET delivery_status=?,close_outcome=?,integrated_commit=?,closed_at=?,updated_at=? WHERE workspace_id=?").bind(status).bind(outcome).bind(commit).bind(t).bind(t).bind(id).execute(&mut *tx).await?;
        sqlx::query("UPDATE workspaces SET status='archived',updated_at=? WHERE id=?")
            .bind(t)
            .bind(id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(())
    }
    pub async fn finish_workspace_repository(
        &self,
        id: &str,
        status: &str,
        outcome: &str,
        commit: Option<&str>,
        t: &str,
    ) -> Result<()> {
        let r=sqlx::query("UPDATE workspace_repositories SET delivery_status=?,close_outcome=?,integrated_commit=?,closed_at=?,updated_at=? WHERE id=?").bind(status).bind(outcome).bind(commit).bind(t).bind(t).bind(id).execute(&self.pool).await?;
        if r.rows_affected() == 0 {
            Err(AppError::NotFound)
        } else {
            Ok(())
        }
    }
    pub async fn archive_workspace(&self, id: &str) -> Result<()> {
        let unfinished:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM workspace_repositories WHERE workspace_id=? AND delivery_status NOT IN ('delivered','pushed','kept','discarded'))").bind(id).fetch_one(&self.pool).await?;
        if unfinished {
            return Err(AppError::BadRequest(
                "all Repositories must be finished before archiving the Workspace".into(),
            ));
        }
        let r = sqlx::query("UPDATE workspaces SET status='archived',updated_at=? WHERE id=?")
            .bind(now())
            .bind(id)
            .execute(&self.pool)
            .await?;
        if r.rows_affected() == 0 {
            Err(AppError::NotFound)
        } else {
            Ok(())
        }
    }
    pub async fn workspace_detail(&self, id: &str) -> Result<WorkspaceDetail> {
        let workspace = self.workspace(id).await?;
        let todos = if workspace.kind == "fork" {
            self.todo_for_fork(id).await?.into_iter().collect()
        } else {
            self.todos(id).await?
        };
        Ok(WorkspaceDetail {
            project: self.project(&workspace.project_id).await?,
            repositories: self.workspace_repositories(id).await?,
            directories: self.workspace_directories(id).await?,
            sessions: self.sessions(id).await?,
            todos,
            forks: self.forks(id).await?,
            workspace,
        })
    }
}
