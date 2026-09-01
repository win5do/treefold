# Project, Repository, Directory, Workspace, Fork, and Session

Treefold separates Git lifecycle from the directory in which a Session starts:

```text
Project
├── Repository
│   ├── Directory (repository root, relative path `.`)
│   └── Directory (scope such as `apps/web`)
├── Repository
│   └── Directory
├── Non-Git Directory
└── Workspace
    ├── WorkspaceRepository (one worktree per Repository)
    ├── WorkspaceDirectory (immutable scope snapshot)
    ├── Session
    └── Fork
```

## Project Repository and Directory

A `ProjectRepository` owns canonical Git identity and policy: source root, Git
common directory, remote, base branch, delivery mode, status, and one setup
command with a repository-relative setup workdir. A Project cannot register the
same Git common directory through another linked worktree.

Adding or cloning a Repository records its Git identity before choosing branch
policy. Base branch and delivery mode are configured from local branches and
available remotes when the first Workspace needs them, then persist as Project
Repository defaults for later Workspaces.

A `ProjectDirectory` is only a working scope. A Git Directory stores a
Repository id and a normalized relative path; a Non-Git Directory stores an
external absolute path and is read-only context. Repository root is an ordinary
scope represented by `.`. Duplicate scopes and relative paths which escape the
Repository are rejected.

`default_directory_id` selects the default Git scope. The Directory must be
ready and belong to this Project; its Repository is therefore the derived
default Repository. Removing the default requires selecting another Git
Directory first. A Directory or Repository referenced by a Workspace/Fork
snapshot cannot be removed.

Adding another scope from an already registered source worktree creates only a
Directory. Repository Git/setup configuration is shown only on first discovery.
Adding scopes later never changes existing Workspace snapshots.

## Workspace Repository and Directory snapshots

Workspace creation snapshots each Repository exactly once into a
`WorkspaceRepository`, with one full worktree, one shared feature branch name,
upstream, delivery, rebase/reset, and Finish state. Each selected Project scope
becomes a `WorkspaceDirectory`: Git paths map to
`checkout_root/relative_path`, while Non-Git paths keep their external location
and read-only access.

Worktree creation may partially fail. The Workspace and successful repositories
are retained, and a failed Repository remains visible with its error and a
discarded delivery state. Setup starts once per ready Repository in a visible
Shell at its configured root, existing scope, or validated custom relative
workdir; setup failure does not roll back the Workspace.

Pull All and Push All execute each Repository once. Git mutations for one
canonical Git common directory are serialized, while unrelated repositories may
run concurrently.

## Fork

A Fork is one level of parallel work beneath a Workspace. It creates one
worktree per parent Workspace Repository from the parent's current HEAD and
snapshots all Directory scopes onto those worktrees. Forks cannot nest. Finish
and delivery operate per Repository, not per Directory.

## Session access

Project pages create Shell and Codex Sessions in the selected Project Directory.
An internal `base` Workspace owns their process and persistence records but is
not shown as a development Workspace and never owns Todos or delivery state.
Project Codex Sessions are retained for resume; Shell Sessions are removed from
the database when closed and completed Shells are pruned. Other ready Git
Repositories are writable additional roots, while Non-Git Directories are
read-only context. Because Project Sessions operate directly in source
checkouts, the UI warns that they do not have Workspace worktree or delivery
protection.

Workspace and Fork Sessions use their owning worktrees. Shell Sessions have the
same ephemeral lifecycle as Project Shells, while Codex Sessions retain their
history for resume.

Session creation continues to accept `project_directory_id`. Its cwd is the
selected Directory scope. An Agent receives the complete owning Repository root
as writable, plus deduplicated roots for other Git repositories. Non-Git
Directories can be Shell cwd values and Agent read-only context, but cannot host
an Agent.

If the default Repository failed during Workspace creation, an implicit Session
selection falls back to another ready Git Directory. An explicitly selected
unavailable Directory reports the corresponding Repository error.

## Git and delivery API

Individual Git resources are Repository ids:

- Project: `/api/project-repositories/{id}/git/...`
- Workspace/Fork: `/api/workspace-repositories/{id}/git/...`

History, upstream, delivery preflight, rebase, reset, and Finish use the same
resource identity. The former `project-location` and `workspace-location` HTTP
routes are intentionally absent. The external `/api/v1/agent` capability stays
compatible.

## Development schema migration

The current SQLite database generation is 1 at
`$TREEFOLD_HOME/data/treefold_1.sqlite`. SQLx manages immutable UTC timestamped
migrations within `src-tauri/migrations/g1` through `_sqlx_migrations`, while
SQLite `user_version` exclusively identifies the database generation. All
domain tables are `STRICT`. Append a forward-only migration for every
within-generation schema or data change; never edit or squash a committed
migration in a published generation. The pre-SQLx `treefold.db`,
`treefold.db-wal`, and `treefold.db-shm` files are ignored and left untouched.

Major generations use a new fixed filename and migration directory. A future
g2 upgrade creates and validates a temporary `treefold_2.sqlite`, copies data
with explicit g1-to-g2 conversion code, then closes and atomically renames it.
The g1 database remains in place for rollback.
