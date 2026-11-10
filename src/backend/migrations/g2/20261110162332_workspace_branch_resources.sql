-- Creation intent is historical; the checkout itself owns the current branch.
ALTER TABLE workspace_repositories RENAME COLUMN branch TO creation_branch;
ALTER TABLE workspace_repositories RENAME COLUMN branch_ownership TO creation_branch_ownership;
CREATE TABLE workspace_managed_branches (
 workspace_repository_id TEXT NOT NULL REFERENCES workspace_repositories(id) ON DELETE CASCADE,
 branch TEXT NOT NULL,
 PRIMARY KEY (workspace_repository_id, branch)
) STRICT;
INSERT INTO workspace_managed_branches(workspace_repository_id, branch)
 SELECT id, creation_branch FROM workspace_repositories
 WHERE creation_branch_ownership = 'managed' AND creation_branch IS NOT NULL;
-- Explicit delivery configuration belongs to a branch, not to the checkout.
CREATE TABLE workspace_branch_upstreams (
 workspace_repository_id TEXT NOT NULL REFERENCES workspace_repositories(id) ON DELETE CASCADE,
 branch TEXT NOT NULL, remote_name TEXT, remote_branch TEXT,
 PRIMARY KEY (workspace_repository_id, branch)
) STRICT;
INSERT INTO workspace_branch_upstreams
 SELECT id, creation_branch, remote_name, remote_branch FROM workspace_repositories
 WHERE creation_branch IS NOT NULL AND remote_name IS NOT NULL;
ALTER TABLE workspace_repositories DROP COLUMN remote_name;
ALTER TABLE workspace_repositories DROP COLUMN remote_branch;
-- Existing previews lack a source branch snapshot and must be regenerated.
ALTER TABLE delivery_preflights ADD COLUMN source_branch TEXT NOT NULL DEFAULT '';
