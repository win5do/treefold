CREATE TABLE parent_operations_squash (
 id TEXT PRIMARY KEY, workspace_repository_id TEXT NOT NULL REFERENCES workspace_repositories(id) ON DELETE CASCADE,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 direction TEXT NOT NULL CHECK(direction IN ('update','integrate')), strategy TEXT NOT NULL CHECK(strategy IN ('rebase','merge','squash')),
 origin TEXT NOT NULL DEFAULT 'standalone' CHECK(origin IN ('standalone','finish','legacy')),
 source_repository_id TEXT NOT NULL, source_path TEXT NOT NULL, source_branch TEXT NOT NULL,
 target_scope TEXT NOT NULL, target_workspace_id TEXT, target_path TEXT NOT NULL, target_branch TEXT NOT NULL,
 source_head TEXT NOT NULL, parent_head TEXT NOT NULL, before_head TEXT NOT NULL, result_head TEXT,
 recovery_ref TEXT NOT NULL, status TEXT NOT NULL, phase TEXT NOT NULL, resolver_session_id TEXT,
 delivery_operation_id TEXT, undo_available INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '',
 started_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT
) STRICT;
INSERT INTO parent_operations_squash SELECT * FROM parent_operations;
DROP TABLE parent_operations;
ALTER TABLE parent_operations_squash RENAME TO parent_operations;
CREATE INDEX parent_operations_repository_updated ON parent_operations(workspace_repository_id,direction,updated_at DESC);
CREATE INDEX parent_operations_target_updated ON parent_operations(source_repository_id,target_path,updated_at DESC);
