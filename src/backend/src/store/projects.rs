#![allow(dead_code)]
use super::{Store, now};
use crate::{
    error::{AppError, Result},
    ids::new_id,
    model::*,
};
use std::path::{Path, PathBuf};

const PROJECT_COLUMNS: &str =
    "id,name,description,status,default_directory_id,created_at,updated_at";
const REPOSITORY_COLUMNS: &str = "id,project_id,name,source_root,git_common_dir,source_ownership,repository_url,preferred_remote_name,setup_command,setup_workdir,git_status,last_checked_at,created_at,updated_at";
const DIRECTORY_COLUMNS: &str = "d.id,d.project_id,d.repository_id,d.name,d.description,d.relative_path,d.external_path,d.status,d.created_at,d.updated_at,r.name AS repository_name,r.source_root,r.git_common_dir,r.repository_url,r.preferred_remote_name,r.setup_command,r.setup_workdir,r.git_status AS repository_status,r.last_checked_at";

#[derive(sqlx::FromRow)]
struct ProjectRow {
    id: String,
    name: String,
    description: String,
    status: String,
    default_directory_id: Option<String>,
    created_at: String,
    updated_at: String,
}
impl From<ProjectRow> for Project {
    fn from(r: ProjectRow) -> Self {
        Self {
            id: r.id,
            name: r.name,
            description: r.description,
            status: r.status,
            default_location_id: r.default_directory_id.clone(),
            created_at: r.created_at,
            updated_at: r.updated_at,
            primary_directory_id: r.default_directory_id.unwrap_or_default(),
            git_common_dir: String::new(),
            preferred_remote: None,
        }
    }
}
#[derive(sqlx::FromRow)]
struct DirectoryRow {
    id: String,
    project_id: String,
    repository_id: Option<String>,
    name: String,
    description: String,
    relative_path: Option<String>,
    external_path: Option<String>,
    status: String,
    created_at: String,
    updated_at: String,
    repository_name: Option<String>,
    source_root: Option<String>,
    git_common_dir: Option<String>,
    repository_url: Option<String>,
    preferred_remote_name: Option<String>,
    setup_command: Option<String>,
    setup_workdir: Option<String>,
    repository_status: Option<String>,
    last_checked_at: Option<String>,
}
impl DirectoryRow {
    fn as_directory(&self) -> Directory {
        let is_git = self.repository_id.is_some();
        Directory {
            id: self.id.clone(),
            project_id: self.project_id.clone(),
            name: self.name.clone(),
            description: self.description.clone(),
            worktree_setup_command: self.setup_command.clone().unwrap_or_default(),
            path: scope_path(
                self.source_root.as_deref(),
                self.relative_path.as_deref(),
                self.external_path.as_deref(),
            ),
            repository_url: self.repository_url.clone(),
            preferred_remote_name: self.preferred_remote_name.clone(),
            git_common_dir: self.git_common_dir.clone(),
            git_status: if is_git {
                self.repository_status
                    .clone()
                    .unwrap_or_else(|| "missing".into())
            } else {
                self.status.clone()
            },
            last_checked_at: self.last_checked_at.clone(),
            created_at: self.created_at.clone(),
            updated_at: self.updated_at.clone(),
            checkout_path: self.source_root.clone(),
            role: "attached".into(),
            is_git,
            remote_url: self.repository_url.clone(),
            branch: None,
            head_commit: None,
            head_summary: None,
            dirty: false,
        }
    }
    fn as_project_directory(self) -> ProjectDirectory {
        ProjectDirectory {
            id: self.id,
            project_id: self.project_id,
            repository_id: self.repository_id,
            name: self.name,
            description: self.description,
            relative_path: self.relative_path.clone(),
            external_path: self.external_path.clone(),
            path: scope_path(
                self.source_root.as_deref(),
                self.relative_path.as_deref(),
                self.external_path.as_deref(),
            ),
            status: self.status,
            created_at: self.created_at,
            updated_at: self.updated_at,
        }
    }
}
#[derive(sqlx::FromRow)]
struct SummaryRow {
    id: String,
    name: String,
    description: String,
    status: String,
    updated_at: String,
    location_count: i64,
    git_location_count: i64,
    context_location_count: i64,
    missing_location_count: i64,
    abnormal_location_count: i64,
    active_workspace_count: i64,
}
impl From<SummaryRow> for ProjectSummary {
    fn from(r: SummaryRow) -> Self {
        Self {
            id: r.id,
            name: r.name,
            description: r.description,
            status: r.status,
            updated_at: r.updated_at,
            location_count: r.location_count,
            git_location_count: r.git_location_count,
            context_location_count: r.context_location_count,
            missing_location_count: r.missing_location_count,
            abnormal_location_count: r.abnormal_location_count,
            active_workspace_count: r.active_workspace_count,
        }
    }
}

impl Store {
    async fn project_rows(
        &self,
        sql: impl sqlx::SqlSafeStr,
        id: Option<&str>,
    ) -> Result<Vec<Project>> {
        let q = sqlx::query_as::<_, ProjectRow>(sql);
        let rows = if let Some(id) = id {
            q.bind(id).fetch_all(&self.pool).await?
        } else {
            q.fetch_all(&self.pool).await?
        };
        Ok(rows.into_iter().map(Into::into).collect())
    }
    pub async fn projects(&self) -> Result<Vec<Project>> {
        self.project_rows(
            static_sql!("SELECT {PROJECT_COLUMNS} FROM projects ORDER BY updated_at DESC"),
            None,
        )
        .await
    }
    pub async fn project(&self, id: &str) -> Result<Project> {
        let r: ProjectRow = sqlx::query_as(static_sql!(
            "SELECT {PROJECT_COLUMNS} FROM projects WHERE id=?"
        ))
        .bind(id)
        .fetch_one(&self.pool)
        .await?;
        Ok(r.into())
    }
    pub async fn create_empty_project(&self, p: &Project) -> Result<()> {
        sqlx::query("INSERT INTO projects(id,name,description,status,default_directory_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").bind(&p.id).bind(&p.name).bind(&p.description).bind(&p.status).bind(&p.default_location_id).bind(&p.created_at).bind(&p.updated_at).execute(&self.pool).await?;
        Ok(())
    }
    pub async fn update_project_defaults(&self, id: &str, d: Option<&str>) -> Result<()> {
        let r = sqlx::query("UPDATE projects SET default_directory_id=?,updated_at=? WHERE id=?")
            .bind(d)
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
    pub async fn update_project_status(&self, id: &str, status: &str) -> Result<()> {
        let r = sqlx::query("UPDATE projects SET status=?,updated_at=? WHERE id=?")
            .bind(status)
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
    pub async fn rename_project(&self, id: &str, name: &str, description: &str) -> Result<()> {
        let r = sqlx::query("UPDATE projects SET name=?,description=?,updated_at=? WHERE id=?")
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
    pub async fn delete_project(&self, id: &str) -> Result<()> {
        let r = sqlx::query("DELETE FROM projects WHERE id=?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        if r.rows_affected() == 0 {
            Err(AppError::NotFound)
        } else {
            Ok(())
        }
    }
    pub async fn repositories(&self, id: &str) -> Result<Vec<ProjectRepository>> {
        Ok(sqlx::query_as::<_,ProjectRepository>(static_sql!("SELECT {REPOSITORY_COLUMNS} FROM project_repositories WHERE project_id=? AND deleted_at IS NULL ORDER BY created_at,id")).bind(id).fetch_all(&self.pool).await?)
    }
    pub async fn repository(&self, id: &str) -> Result<ProjectRepository> {
        Ok(sqlx::query_as::<_,ProjectRepository>(static_sql!("SELECT {REPOSITORY_COLUMNS} FROM project_repositories WHERE id=? AND deleted_at IS NULL")).bind(id).fetch_one(&self.pool).await?)
    }
    pub async fn repository_as_directory(&self, id: &str) -> Result<Directory> {
        let r = self.repository(id).await?;
        Ok(Directory {
            id: r.id,
            project_id: r.project_id,
            name: r.name,
            description: String::new(),
            worktree_setup_command: r.setup_command,
            path: r.source_root.clone(),
            repository_url: r.repository_url.clone(),
            preferred_remote_name: r.preferred_remote_name,
            git_common_dir: Some(r.git_common_dir),
            git_status: r.git_status,
            last_checked_at: r.last_checked_at,
            created_at: r.created_at,
            updated_at: r.updated_at,
            checkout_path: Some(r.source_root),
            role: "repository".into(),
            is_git: true,
            remote_url: r.repository_url,
            branch: None,
            head_commit: None,
            head_summary: None,
            dirty: false,
        })
    }
    async fn directory_rows(
        &self,
        sql: impl sqlx::SqlSafeStr,
        id: &str,
    ) -> Result<Vec<DirectoryRow>> {
        Ok(sqlx::query_as(sql).bind(id).fetch_all(&self.pool).await?)
    }
    pub async fn directories(&self, id: &str) -> Result<Vec<Directory>> {
        let rows=self.directory_rows(static_sql!("SELECT {DIRECTORY_COLUMNS} FROM project_directories d LEFT JOIN project_repositories r ON r.id=d.repository_id JOIN projects p ON p.id=d.project_id WHERE d.project_id=? AND d.deleted_at IS NULL AND (r.id IS NULL OR r.deleted_at IS NULL) ORDER BY d.id=p.default_directory_id DESC,d.created_at,d.rowid"),id).await?;
        Ok(rows.iter().map(DirectoryRow::as_directory).collect())
    }
    pub async fn project_directories(&self, id: &str) -> Result<Vec<ProjectDirectory>> {
        Ok(self.directory_rows(static_sql!("SELECT {DIRECTORY_COLUMNS} FROM project_directories d LEFT JOIN project_repositories r ON r.id=d.repository_id JOIN projects p ON p.id=d.project_id WHERE d.project_id=? AND d.deleted_at IS NULL AND (r.id IS NULL OR r.deleted_at IS NULL) ORDER BY d.id=p.default_directory_id DESC,r.created_at,d.created_at,d.id"),id).await?.into_iter().map(DirectoryRow::as_project_directory).collect())
    }
    pub async fn directory(&self, id: &str) -> Result<Directory> {
        let r:DirectoryRow=sqlx::query_as(static_sql!("SELECT {DIRECTORY_COLUMNS} FROM project_directories d LEFT JOIN project_repositories r ON r.id=d.repository_id WHERE d.id=? AND d.deleted_at IS NULL AND (r.id IS NULL OR r.deleted_at IS NULL)")).bind(id).fetch_one(&self.pool).await?;
        Ok(r.as_directory())
    }
    pub async fn directory_record(&self, id: &str) -> Result<ProjectDirectory> {
        let r:DirectoryRow=sqlx::query_as(static_sql!("SELECT {DIRECTORY_COLUMNS} FROM project_directories d LEFT JOIN project_repositories r ON r.id=d.repository_id WHERE d.id=? AND d.deleted_at IS NULL AND (r.id IS NULL OR r.deleted_at IS NULL)")).bind(id).fetch_one(&self.pool).await?;
        Ok(r.as_project_directory())
    }
    pub async fn directory_repository_id(&self, id: &str) -> Result<Option<String>> {
        Ok(sqlx::query_scalar(
            "SELECT repository_id FROM project_directories WHERE id=? AND deleted_at IS NULL",
        )
        .bind(id)
        .fetch_one(&self.pool)
        .await?)
    }
    pub async fn create_directory(&self, d: &Directory) -> Result<String> {
        self.create_directory_with_repository_id(d, None, "external")
            .await
    }
    pub async fn create_directory_with_repository_id(
        &self,
        d: &Directory,
        forced: Option<&str>,
        ownership: &str,
    ) -> Result<String> {
        let mut tx = self.pool.begin().await?;
        let repository_id = if let Some(common) = d.git_common_dir.as_deref() {
            let root = d.checkout_path.as_deref().unwrap_or(&d.path);
            let existing:Option<(String,String,Option<String>)>=sqlx::query_as("SELECT id,source_root,deleted_at FROM project_repositories WHERE project_id=? AND git_common_dir=?").bind(&d.project_id).bind(common).fetch_optional(&mut *tx).await?;
            if let Some((id, existing_root, deleted)) = existing {
                if deleted.is_none() && normalized_path(&existing_root) != normalized_path(root) {
                    return Err(AppError::BadRequest(format!(
                        "repository is already associated with source worktree {existing_root}; add scopes from that worktree"
                    )));
                }
                if deleted.is_some() {
                    sqlx::query("UPDATE project_repositories SET name=?,source_root=?,source_ownership=?,repository_url=?,preferred_remote_name=?,git_status=?,last_checked_at=?,updated_at=?,deleted_at=NULL WHERE id=?").bind(basename(root)).bind(root).bind(ownership).bind(&d.repository_url).bind(&d.preferred_remote_name).bind(&d.git_status).bind(&d.last_checked_at).bind(&d.updated_at).bind(&id).execute(&mut *tx).await?;
                }
                id
            } else {
                let id = forced.map(str::to_owned).unwrap_or_else(new_id);
                sqlx::query("INSERT INTO project_repositories(id,project_id,name,source_root,git_common_dir,source_ownership,repository_url,preferred_remote_name,setup_command,setup_workdir,git_status,last_checked_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(&id).bind(&d.project_id).bind(basename(root)).bind(root).bind(common).bind(ownership).bind(&d.repository_url).bind(&d.preferred_remote_name).bind(&d.worktree_setup_command).bind(".").bind(&d.git_status).bind(&d.last_checked_at).bind(&d.created_at).bind(&d.updated_at).execute(&mut *tx).await?;
                id
            }
        } else {
            String::new()
        };
        let relative = if repository_id.is_empty() {
            None
        } else {
            Some(relative_scope(
                d.checkout_path.as_deref().unwrap_or(&d.path),
                &d.path,
            )?)
        };
        let existing: Option<(String, Option<String>)> = if repository_id.is_empty() {
            sqlx::query_as("SELECT id,deleted_at FROM project_directories WHERE project_id=? AND external_path=?").bind(&d.project_id).bind(&d.path).fetch_optional(&mut *tx).await?
        } else {
            sqlx::query_as("SELECT id,deleted_at FROM project_directories WHERE repository_id=? AND relative_path=?").bind(&repository_id).bind(&relative).fetch_optional(&mut *tx).await?
        };
        if let Some((id, deleted)) = existing {
            if deleted.is_none() {
                return Err(AppError::BadRequest(
                    "directory is already part of this Project".into(),
                ));
            }
            sqlx::query("UPDATE project_directories SET name=?,description=?,status=?,updated_at=?,deleted_at=NULL WHERE id=?").bind(&d.name).bind(&d.description).bind(&d.git_status).bind(&d.updated_at).bind(&id).execute(&mut *tx).await?;
            if d.git_common_dir.is_some() {
                sqlx::query("UPDATE projects SET default_directory_id=COALESCE(default_directory_id,?),updated_at=? WHERE id=?").bind(&id).bind(now()).bind(&d.project_id).execute(&mut *tx).await?;
            }
            tx.commit().await?;
            return Ok(id);
        }
        let repo = (!repository_id.is_empty()).then_some(repository_id);
        let external = d.git_common_dir.is_none().then_some(d.path.clone());
        sqlx::query("INSERT INTO project_directories(id,project_id,repository_id,name,description,relative_path,external_path,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(&d.id).bind(&d.project_id).bind(repo).bind(&d.name).bind(&d.description).bind(relative).bind(external).bind(&d.git_status).bind(&d.created_at).bind(&d.updated_at).execute(&mut *tx).await?;
        if d.git_common_dir.is_some() {
            sqlx::query("UPDATE projects SET default_directory_id=COALESCE(default_directory_id,?),updated_at=? WHERE id=?").bind(&d.id).bind(now()).bind(&d.project_id).execute(&mut *tx).await?;
        }
        tx.commit().await?;
        Ok(d.id.clone())
    }
    pub async fn update_directory(
        &self,
        id: &str,
        name: &str,
        description: &str,
        setup: &str,
    ) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        let repo: Option<String> = sqlx::query_scalar(
            "SELECT repository_id FROM project_directories WHERE id=? AND deleted_at IS NULL",
        )
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
        sqlx::query("UPDATE project_directories SET name=?,description=?,updated_at=? WHERE id=? AND deleted_at IS NULL").bind(name).bind(description).bind(now()).bind(id).execute(&mut *tx).await?;
        if let Some(repo) = repo {
            sqlx::query("UPDATE project_repositories SET setup_command=?,updated_at=? WHERE id=?")
                .bind(setup)
                .bind(now())
                .bind(repo)
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        Ok(())
    }
    pub async fn update_repository(
        &self,
        id: &str,
        setup: &str,
        workdir: &str,
        remote: Option<Option<&str>>,
    ) -> Result<()> {
        let update_remote = remote.is_some();
        let remote_name = remote.flatten();
        let r = sqlx::query!("UPDATE project_repositories SET setup_command=?,setup_workdir=?,preferred_remote_name=CASE WHEN ? THEN ? ELSE preferred_remote_name END,updated_at=? WHERE id=? AND deleted_at IS NULL", setup, workdir, update_remote, remote_name, now(), id).execute(&self.pool).await?;
        if r.rows_affected() == 0 {
            Err(AppError::NotFound)
        } else {
            Ok(())
        }
    }
    pub async fn refresh_repository(&self, r: &ProjectRepository) -> Result<()> {
        let q=sqlx::query("UPDATE project_repositories SET name=?,source_root=?,git_common_dir=?,repository_url=?,preferred_remote_name=?,setup_command=?,setup_workdir=?,git_status=?,last_checked_at=?,updated_at=? WHERE id=? AND deleted_at IS NULL").bind(&r.name).bind(&r.source_root).bind(&r.git_common_dir).bind(&r.repository_url).bind(&r.preferred_remote_name).bind(&r.setup_command).bind(&r.setup_workdir).bind(&r.git_status).bind(&r.last_checked_at).bind(&r.updated_at).bind(&r.id).execute(&self.pool).await?;
        if q.rows_affected() == 0 {
            Err(AppError::NotFound)
        } else {
            Ok(())
        }
    }
    pub async fn reattach_repository(
        &self,
        id: &str,
        root: &str,
        common: &str,
        url: Option<&str>,
        remote: Option<&str>,
    ) -> Result<()> {
        let t = now();
        let r=sqlx::query("UPDATE project_repositories SET source_root=?,git_common_dir=?,source_ownership='external',repository_url=?,preferred_remote_name=?,git_status='ready',last_checked_at=?,updated_at=? WHERE id=? AND deleted_at IS NULL").bind(root).bind(common).bind(url).bind(remote).bind(&t).bind(&t).bind(id).execute(&self.pool).await?;
        if r.rows_affected() == 0 {
            Err(AppError::NotFound)
        } else {
            Ok(())
        }
    }
    pub async fn refresh_project_directory(&self, d: &Directory) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        let repo: Option<String> = sqlx::query_scalar(
            "SELECT repository_id FROM project_directories WHERE id=? AND deleted_at IS NULL",
        )
        .bind(&d.id)
        .fetch_one(&mut *tx)
        .await?;
        sqlx::query("UPDATE project_directories SET name=?,status=?,updated_at=? WHERE id=? AND deleted_at IS NULL").bind(&d.name).bind(&d.git_status).bind(&d.updated_at).bind(&d.id).execute(&mut *tx).await?;
        if let Some(repo) = repo {
            sqlx::query("UPDATE project_repositories SET source_root=COALESCE(?,source_root),repository_url=COALESCE(repository_url,?),preferred_remote_name=COALESCE(preferred_remote_name,?),git_common_dir=COALESCE(?,git_common_dir),git_status=?,last_checked_at=?,updated_at=? WHERE id=? AND deleted_at IS NULL").bind(&d.checkout_path).bind(&d.repository_url).bind(&d.preferred_remote_name).bind(&d.git_common_dir).bind(&d.git_status).bind(&d.last_checked_at).bind(&d.updated_at).bind(repo).execute(&mut *tx).await?;
        }
        tx.commit().await?;
        Ok(())
    }
    pub async fn delete_project_directory(&self, id: &str) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        let(project,repo,is_default):(String,Option<String>,bool)=sqlx::query_as("SELECT d.project_id,d.repository_id,COALESCE(d.id=p.default_directory_id,0) FROM project_directories d JOIN projects p ON p.id=d.project_id WHERE d.id=? AND d.deleted_at IS NULL").bind(id).fetch_one(&mut *tx).await?;
        if is_default {
            return Err(AppError::BadRequest(
                "choose another default Directory before removing this one".into(),
            ));
        }
        let referenced:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM workspace_directories wd JOIN workspaces w ON w.id=wd.workspace_id WHERE wd.project_directory_id=? AND w.status='active')").bind(id).fetch_one(&mut *tx).await?;
        if referenced {
            return Err(AppError::BadRequest(
                "directory is used by an active Workspace or Fork".into(),
            ));
        }
        let t = now();
        sqlx::query("UPDATE project_directories SET deleted_at=?,updated_at=? WHERE id=? AND deleted_at IS NULL").bind(&t).bind(&t).bind(id).execute(&mut *tx).await?;
        if let Some(repo) = repo {
            let scopes:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM project_directories WHERE repository_id=? AND deleted_at IS NULL)").bind(&repo).fetch_one(&mut *tx).await?;
            if !scopes {
                let used:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM workspace_repositories wr JOIN workspaces w ON w.id=wr.workspace_id WHERE wr.project_repository_id=? AND w.status='active')").bind(&repo).fetch_one(&mut *tx).await?;
                if used {
                    return Err(AppError::BadRequest(
                        "repository is used by an active Workspace or Fork".into(),
                    ));
                }
                sqlx::query("UPDATE project_repositories SET deleted_at=?,updated_at=? WHERE id=? AND deleted_at IS NULL").bind(&t).bind(&t).bind(repo).execute(&mut *tx).await?;
            }
        }
        sqlx::query("UPDATE projects SET updated_at=? WHERE id=?")
            .bind(now())
            .bind(project)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(())
    }
    pub async fn delete_repository(&self, id: &str) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        let used:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM workspace_repositories wr JOIN workspaces w ON w.id=wr.workspace_id WHERE wr.project_repository_id=? AND w.status='active')").bind(id).fetch_one(&mut *tx).await?;
        if used {
            return Err(AppError::BadRequest(
                "repository is used by an active Workspace or Fork".into(),
            ));
        }
        let default:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM project_directories d JOIN projects p ON p.default_directory_id=d.id WHERE d.repository_id=?)").bind(id).fetch_one(&mut *tx).await?;
        if default {
            return Err(AppError::BadRequest(
                "choose a default Directory in another Repository first".into(),
            ));
        }
        let t = now();
        sqlx::query("UPDATE project_directories SET deleted_at=?,updated_at=? WHERE repository_id=? AND deleted_at IS NULL").bind(&t).bind(&t).bind(id).execute(&mut *tx).await?;
        let r=sqlx::query("UPDATE project_repositories SET deleted_at=?,updated_at=? WHERE id=? AND deleted_at IS NULL").bind(&t).bind(&t).bind(id).execute(&mut *tx).await?;
        if r.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        tx.commit().await?;
        Ok(())
    }
    pub async fn project_detail(&self, id: &str) -> Result<ProjectDetail> {
        Ok(ProjectDetail {
            project: self.project(id).await?,
            repositories: self.repositories(id).await?,
            directories: self.project_directories(id).await?,
            sessions: self.project_sessions(id).await?,
            workspaces: self
                .workspaces(id)
                .await?
                .into_iter()
                .filter(|w| w.kind == "workspace")
                .collect(),
            worktrees: vec![],
        })
    }
    pub async fn project_summaries_async(&self) -> Result<Vec<ProjectSummary>> {
        let rows:Vec<SummaryRow>=sqlx::query_as("SELECT p.id,p.name,p.description,p.status,p.updated_at,COUNT(DISTINCT d.id) location_count,COUNT(DISTINCT CASE WHEN d.repository_id IS NOT NULL THEN d.id END) git_location_count,COUNT(DISTINCT CASE WHEN d.repository_id IS NULL THEN d.id END) context_location_count,COUNT(DISTINCT CASE WHEN d.repository_id IS NULL THEN d.id END) missing_location_count,COUNT(DISTINCT CASE WHEN d.status NOT IN ('ready','not_git','missing') THEN d.id END) abnormal_location_count,COUNT(DISTINCT CASE WHEN w.status='active' AND w.kind='workspace' THEN w.id END) active_workspace_count FROM projects p LEFT JOIN project_directories d ON d.project_id=p.id AND d.deleted_at IS NULL LEFT JOIN workspaces w ON w.project_id=p.id GROUP BY p.id ORDER BY p.updated_at DESC").fetch_all(&self.pool).await?;
        Ok(rows.into_iter().map(Into::into).collect())
    }
    pub async fn sidebar_async(&self) -> Result<SidebarData> {
        let projects=self.project_rows(static_sql!("SELECT {PROJECT_COLUMNS} FROM projects WHERE status='active' ORDER BY updated_at DESC"),None).await?;
        let mut out = vec![];
        for project in projects {
            let repositories = self.repositories(&project.id).await?;
            let directories = self.project_directories(&project.id).await?;
            let sessions = self
                .project_sessions(&project.id)
                .await?
                .into_iter()
                .filter(|s| s.visibility == "visible")
                .collect();
            let mut sw = vec![];
            for workspace in self
                .workspaces(&project.id)
                .await?
                .into_iter()
                .filter(|w| w.status == "active" && w.kind != "base")
            {
                sw.push(SidebarWorkspace {
                    sessions: self
                        .sessions(&workspace.id)
                        .await?
                        .into_iter()
                        .filter(|s| s.visibility == "visible")
                        .collect(),
                    repositories: self.workspace_repositories(&workspace.id).await?,
                    directories: self.workspace_directories(&workspace.id).await?,
                    workspace,
                })
            }
            out.push(SidebarProject {
                project,
                repositories,
                directories,
                sessions,
                workspaces: sw,
            })
        }
        Ok(SidebarData { projects: out })
    }
}
fn scope_path(root: Option<&str>, relative: Option<&str>, external: Option<&str>) -> String {
    match (root, relative, external) {
        (Some(r), Some("."), _) => r.into(),
        (Some(r), Some(p), _) => Path::new(r).join(p).to_string_lossy().into_owned(),
        (_, _, Some(p)) => p.into(),
        _ => String::new(),
    }
}
fn relative_scope(root: &str, selected: &str) -> Result<String> {
    let root = PathBuf::from(root);
    let selected = PathBuf::from(selected);
    let relative = selected.strip_prefix(&root).map_err(|_| {
        AppError::BadRequest("Directory must be inside the Repository source root".into())
    })?;
    Ok(if relative.as_os_str().is_empty() {
        ".".into()
    } else {
        relative.to_string_lossy().replace('\\', "/")
    })
}
fn normalized_path(path: &str) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| PathBuf::from(path))
}
fn basename(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or("repository")
        .to_owned()
}
