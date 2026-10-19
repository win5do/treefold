ALTER TABLE workspaces ADD COLUMN default_delivery TEXT NOT NULL DEFAULT 'local_merge'
    CHECK (default_delivery IN ('local_merge', 'push_branch'));
