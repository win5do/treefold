CREATE TABLE projects (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'active',
 default_directory_id TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE project_repositories (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 name TEXT NOT NULL, source_root TEXT NOT NULL, git_common_dir TEXT NOT NULL,
 source_ownership TEXT NOT NULL DEFAULT 'external' CHECK(source_ownership IN ('managed','external')),
 repository_url TEXT, preferred_remote_name TEXT,
 base_branch TEXT, delivery_mode TEXT,
 setup_command TEXT NOT NULL DEFAULT '', setup_workdir TEXT NOT NULL DEFAULT '.',
 git_status TEXT NOT NULL DEFAULT 'ready', last_checked_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
 UNIQUE(project_id,git_common_dir)
);
CREATE TABLE project_directories (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 repository_id TEXT REFERENCES project_repositories(id),
 name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', relative_path TEXT, external_path TEXT,
 status TEXT NOT NULL DEFAULT 'ready', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
 CHECK((repository_id IS NOT NULL AND relative_path IS NOT NULL AND external_path IS NULL)
    OR (repository_id IS NULL AND relative_path IS NULL AND external_path IS NOT NULL)),
 UNIQUE(repository_id,relative_path), UNIQUE(project_id,external_path)
);
CREATE TABLE workspaces (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
 kind TEXT NOT NULL DEFAULT 'workspace', parent_workspace_id TEXT REFERENCES workspaces(id),
 runtime_id TEXT NOT NULL DEFAULT '', runtime_name TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE workspace_repositories (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 project_repository_id TEXT NOT NULL REFERENCES project_repositories(id),
 repository_name TEXT NOT NULL, source_root TEXT NOT NULL,
 git_status TEXT NOT NULL, creation_error TEXT, worktree_id TEXT, checkout_path TEXT, branch TEXT,
 base_branch TEXT, start_commit TEXT, forked_from_commit TEXT,
 remote_name TEXT, remote_branch TEXT, branch_ownership TEXT NOT NULL DEFAULT 'managed',
 delivery_mode TEXT NOT NULL DEFAULT 'push_branch', delivery_status TEXT NOT NULL DEFAULT 'active',
 close_outcome TEXT, integrated_commit TEXT, closed_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(workspace_id,project_repository_id)
);
CREATE TABLE workspace_directories (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 project_directory_id TEXT NOT NULL REFERENCES project_directories(id),
 workspace_repository_id TEXT REFERENCES workspace_repositories(id) ON DELETE CASCADE,
 name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', relative_path TEXT, external_path TEXT,
 access_mode TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(workspace_id,project_directory_id)
);
CREATE INDEX workspace_repositories_workspace ON workspace_repositories(workspace_id);
CREATE INDEX workspace_directories_workspace ON workspace_directories(workspace_id);
CREATE INDEX workspaces_project_status_kind_parent
 ON workspaces(project_id,status,kind,parent_workspace_id);
CREATE TRIGGER projects_default_directory_insert
BEFORE INSERT ON projects WHEN NEW.default_directory_id IS NOT NULL
BEGIN SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM project_directories WHERE id=NEW.default_directory_id AND project_id=NEW.id AND repository_id IS NOT NULL AND status='ready' AND deleted_at IS NULL
) THEN RAISE(ABORT,'default directory must belong to an available Repository in this Project') END; END;
CREATE TRIGGER projects_default_directory_update
BEFORE UPDATE OF default_directory_id ON projects WHEN NEW.default_directory_id IS NOT NULL
BEGIN SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM project_directories WHERE id=NEW.default_directory_id AND project_id=NEW.id AND repository_id IS NOT NULL AND status='ready' AND deleted_at IS NULL
) THEN RAISE(ABORT,'default directory must belong to an available Repository in this Project') END; END;
CREATE TABLE sessions (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 name TEXT NOT NULL, kind TEXT NOT NULL, cwd TEXT NOT NULL, original_cwd TEXT NOT NULL,
 initial_prompt TEXT NOT NULL DEFAULT '',
 codex_session_id TEXT, visibility TEXT NOT NULL DEFAULT 'visible' CHECK(visibility IN ('visible','hidden')),
 hidden_at TEXT, evicted_at TEXT,
 amux_workspace_name TEXT NOT NULL DEFAULT '', amux_process_name TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL CHECK(status IN ('running','stopped','exited','failed')),
 exit_code INTEGER, exit_signal TEXT NOT NULL DEFAULT '',
 argv TEXT NOT NULL DEFAULT '[]', io_mode TEXT NOT NULL DEFAULT 'tty' CHECK(io_mode IN ('pipe','tty')),
 launch_started_at TEXT NOT NULL, last_attached_at TEXT,
 sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX sessions_workspace_visible_order
 ON sessions(workspace_id,visibility,sort_order);
CREATE UNIQUE INDEX sessions_amux_identity
 ON sessions(amux_workspace_name,amux_process_name)
 WHERE amux_workspace_name!='' AND amux_process_name!='';
CREATE TABLE session_additional_directories (
 session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, path TEXT NOT NULL,
 access_mode TEXT NOT NULL DEFAULT 'read_write',
 PRIMARY KEY(session_id,path)
);
CREATE TABLE todos (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 content TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','in_progress','blocked','done')),
 fork_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL, blocked_reason TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX todos_fork ON todos(fork_id) WHERE fork_id IS NOT NULL;
CREATE TABLE delivery_operations (
 workspace_repository_id TEXT PRIMARY KEY REFERENCES workspace_repositories(id) ON DELETE CASCADE,
 phase TEXT NOT NULL, code_action TEXT NOT NULL, todo_action TEXT NOT NULL DEFAULT 'keep',
 push_after_merge INTEGER NOT NULL DEFAULT 0,
 keep_session_history INTEGER NOT NULL,
 delete_worktree INTEGER NOT NULL, delete_branch INTEGER NOT NULL,
 commit_message TEXT NOT NULL DEFAULT '', before_head TEXT NOT NULL DEFAULT '',
 source_head TEXT NOT NULL DEFAULT '', target_head TEXT NOT NULL DEFAULT '',
 integrated_commit TEXT, error TEXT NOT NULL DEFAULT '',
 started_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE parent_operations (
 id TEXT PRIMARY KEY,
 workspace_repository_id TEXT NOT NULL REFERENCES workspace_repositories(id) ON DELETE CASCADE,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 direction TEXT NOT NULL CHECK(direction IN ('update','integrate')),
 strategy TEXT NOT NULL CHECK(strategy IN ('rebase','merge')),
 origin TEXT NOT NULL DEFAULT 'standalone' CHECK(origin IN ('standalone','finish','legacy')),
 source_repository_id TEXT NOT NULL,
 source_path TEXT NOT NULL, source_branch TEXT NOT NULL,
 target_scope TEXT NOT NULL, target_workspace_id TEXT,
 target_path TEXT NOT NULL, target_branch TEXT NOT NULL,
 source_head TEXT NOT NULL, parent_head TEXT NOT NULL, before_head TEXT NOT NULL,
 result_head TEXT, recovery_ref TEXT NOT NULL,
 status TEXT NOT NULL, phase TEXT NOT NULL,
 resolver_session_id TEXT, delivery_operation_id TEXT,
 undo_available INTEGER NOT NULL DEFAULT 0,
 error TEXT NOT NULL DEFAULT '', started_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 completed_at TEXT
);
CREATE INDEX parent_operations_repository_updated
 ON parent_operations(workspace_repository_id,direction,updated_at DESC);
CREATE INDEX parent_operations_target_updated
 ON parent_operations(source_repository_id,target_path,updated_at DESC);
CREATE TABLE delivery_preflights (
 id TEXT PRIMARY KEY, workspace_repository_id TEXT NOT NULL REFERENCES workspace_repositories(id) ON DELETE CASCADE,
 code_action TEXT NOT NULL, source_head TEXT NOT NULL, target_head TEXT NOT NULL,
 target_branch TEXT NOT NULL, source_status TEXT NOT NULL, source_dirty INTEGER NOT NULL,
 target_dirty INTEGER NOT NULL, ahead INTEGER NOT NULL, behind INTEGER NOT NULL,
 changed_files TEXT NOT NULL, commits TEXT NOT NULL, diff_stat TEXT NOT NULL,
 blockers TEXT NOT NULL, warnings TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX delivery_preflights_repository_created
 ON delivery_preflights(workspace_repository_id,created_at DESC);
