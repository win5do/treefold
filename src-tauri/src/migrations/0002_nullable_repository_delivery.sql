CREATE TABLE project_repositories_v2 (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 name TEXT NOT NULL, source_root TEXT NOT NULL, git_common_dir TEXT NOT NULL,
 repository_url TEXT, preferred_remote_name TEXT,
 base_branch TEXT, delivery_mode TEXT,
 setup_command TEXT NOT NULL DEFAULT '', setup_workdir TEXT NOT NULL DEFAULT '.',
 git_status TEXT NOT NULL DEFAULT 'ready', last_checked_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
 UNIQUE(project_id,git_common_dir)
);
INSERT INTO project_repositories_v2(
 id,project_id,name,source_root,git_common_dir,repository_url,preferred_remote_name,
 base_branch,delivery_mode,setup_command,setup_workdir,git_status,last_checked_at,
 created_at,updated_at,deleted_at
)
SELECT
 id,project_id,name,source_root,git_common_dir,repository_url,preferred_remote_name,
 base_branch,delivery_mode,setup_command,setup_workdir,git_status,last_checked_at,
 created_at,updated_at,deleted_at
FROM project_repositories;
DROP TABLE project_repositories;
ALTER TABLE project_repositories_v2 RENAME TO project_repositories;
