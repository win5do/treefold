CREATE TABLE workspace_finish_batches (
    workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    state TEXT NOT NULL
) STRICT;
