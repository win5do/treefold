# Project, Locations, Workspace, Fork, and Session

Treefold uses a shallow development hierarchy with explicit repository
locations:

```text
Project
├── ProjectLocation (default Git location)
├── ProjectLocation (additional Git location)
└── ProjectLocation (non-Git context)
    └── Workspace
        ├── WorkspaceLocation (one snapshot per ProjectLocation)
        ├── Session
        ├── Todo
        └── Fork
```

## Project and ProjectLocation

A Project is an organizing record and may initially have no locations. Creating
one only asks for its name and description. A ProjectLocation is a local path
whose name is always derived from the directory basename. It also stores a
description and observed Git identity. Its dynamic status is one of `ready`,
`not_git`, `missing`, `broken`, or `mismatch`.

Base branch, delivery mode, and optional worktree setup command belong to each
Git ProjectLocation. Non-Git locations do not carry Git settings and are used as
read-only context. The add-locations flow accepts multiple paths in one dialog,
checks each path, and only exposes Git settings for rows detected as repositories.

The first ready Git location becomes the default. Creating a Workspace requires
that default to be ready and also blocks when any additional location previously
identified as Git is unavailable. Non-Git locations do not block creation.
Refreshing a non-Git location after `git init` gives future Workspaces Git
capability; existing Workspace snapshots are unchanged.

Project Pull All and Push All operate each Git location independently. Pull is
fast-forward only and requires the user's main directory to already be clean and
on its configured base branch. Treefold never switches that directory for the
user.

## Workspace and WorkspaceLocation

A Workspace is common lifecycle state: name, Project, parent, Sessions, Todos,
and archive status. Repository-specific state belongs to WorkspaceLocation.
At creation time every ProjectLocation is snapshotted:

- every ready Git location gets a managed worktree and the same generated
  feature branch name;
- a non-Git location keeps its original path with `read_only` access;
- base branch, start commit, upstream, and delivery state are stored per Git
  location.

Branch conflicts are checked across all repositories before creation. If any
worktree or setup command fails, created worktrees are removed best-effort and
no Workspace rows are committed.

Workspace Pull All and Push All are best-effort. Their result contains a
`success`, `skipped`, or `failed` item for every location, and successful repos
are not rolled back when another repo fails.

## Fork

A Fork is one level of parallel work beneath a Workspace. Every writable parent
WorkspaceLocation is copied from its current HEAD into a same-named Fork branch;
read-only snapshots are inherited. Forks cannot nest. Each Git location merges
back into the corresponding parent WorkspaceLocation.

## Session access

Codex starts in the default WorkspaceLocation worktree. Other Git worktrees are
passed through `--add-dir` and are writable. Non-Git locations are recorded in
the runtime context as `read_only` but are not passed through `--add-dir`.
Developer instructions repeat this rule and warn that YOLO mode removes sandbox
enforcement, so the read-only marker must still be honored explicitly.

## Finishing and unavailable repositories

Each Git WorkspaceLocation independently chooses `local_merge`,
`remote_merged`, `keep`, or `discard`. A root local merge directly uses the
corresponding ProjectLocation main directory and requires it to exist, be clean,
remain on its configured base branch, and match preflight HEAD. Treefold does not
checkout that directory. A Workspace can be archived only after every writable
location reaches a terminal delivery state.

Moving a main directory uses Reattach. The candidate must be the Git main
worktree, match the saved remote identity when present, retain registrations for
known managed worktrees, and pass `git worktree repair` before the database path
is updated. Missing main directories remain visible as unavailable; reads and
best-effort cleanup continue without assuming that an unverified directory is
safe to delete.
