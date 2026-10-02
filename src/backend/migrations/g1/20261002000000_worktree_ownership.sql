ALTER TABLE workspace_repositories ADD COLUMN worktree_ownership TEXT NOT NULL DEFAULT 'external' CHECK(worktree_ownership IN ('managed', 'external'));

UPDATE workspace_repositories SET worktree_ownership = 'managed'
WHERE branch_ownership = 'managed';
