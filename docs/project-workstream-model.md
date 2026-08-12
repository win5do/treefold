# Project, Workstream, Fork, and Session

Status: Rust/Tauri implementation

## Ownership model

```text
Project
├── primary directory and base branch
├── attached directories
├── carried Todos
└── Workstream
    ├── workspace or managed Git worktree
    ├── Todos
    ├── Session
    │   └── local Shell or Codex PTY
    └── Fork
        ├── managed Git worktree
        ├── Todos
        └── Session
```

A **Project** is the long-lived codebase boundary. A **Workstream** is a
continuous body of work with optional Git isolation. A **Fork** is
an independently developed part of a Workstream. A **Session** is one Shell or
Codex terminal and never owns a worktree.

## Project and Workstream

A Project has one primary directory, a base branch, and any number of attached
directories. Workstreams support two workspace modes:

- `worktree`: create a branch and managed Git worktree from the primary
  directory;
- `in_place`: use the Project directory directly.

Git Projects default to `worktree`; non-Git Projects default to `in_place`.
The Project base branch is captured when the Project is created and is the
integration target for a closed root Workstream.

Each Directory can define an optional Worktree setup command, such as
`npm install`. Treefold runs it after creating every managed Workstream or Fork
for that Directory, with the new worktree as the current directory. The command
runs through the user's login shell so shell operators and user-managed tool
paths are available. `in_place` Workstreams do not run this provisioning step.

## Fork

A Fork starts from its parent Workstream's exact `HEAD`, owns a branch and
managed worktree, and can contain Todos, Shell Sessions, and Codex
Sessions. The parent workspace must be clean when the Fork is created.

The hierarchy is capped at `Project -> Workstream -> Fork`. A Fork cannot create
another Fork. Parallel work is created from the root Workstream instead.

## Session

The Rust backend opens a native PTY with `portable-pty`. Shell Sessions launch
the login shell. Codex Sessions launch `codex` in the owner Workstream or Fork
workspace and receive attached directories through `--add-dir`.

Each Codex launch and resume also receives generated `developer_instructions`
describing the Project, Workstream/Fork, current and original cwd, attached
directories, observed Git state, integration target, and Treefold lifecycle
boundaries. These values are a launch-time snapshot; stable repository rules
remain in `AGENTS.md`.

When a Session is closed, Treefold attempts to capture its Codex conversation ID
from Codex's local session metadata. Closing a Workstream stops its Sessions but
keeps their records by default. If the original worktree is removed, history
retains the original cwd while resume runs in the parent Workstream or Project
directory.

## Close and settle

Closing a Fork or Workstream is an explicit settlement operation. The dialog
lets the user choose how to handle code, Todos, Session history, the
managed worktree, and branch. Defaults are:

- merge a Fork into its parent Workstream, or a root Workstream into the
  Project base branch;
- carry Todos upward, preserving completed status and resetting assigned work
  to pending;
- stop Sessions and retain history for later Codex resume;
- remove the managed worktree and delete the verified merged branch.

Code may instead be preserved without merging or explicitly discarded. Todos
and Session history can independently be retained or discarded. A root
Workstream cannot settle while it has an active Fork.

Settlement preflight checks only lifecycle and Git safety, including active
Forks, source and target state, target branch, and stale snapshots. Project
verification remains part of the Codex workflow and repository instructions;
Close does not run arbitrary test commands.

Git cleanup occurs after code and records are settled. A merge conflict is
aborted, marks the owner as conflicted, and preserves both worktrees and
branches. A merged branch is deleted only after Git verifies that the source is
reachable from the target. Discard is the only flow that force-deletes
unmerged code.

## Lifecycle

- Creating a Session inserts its SQLite record and starts its PTY.
- Stop kills a running PTY.
- Restart or Resume creates a PTY from the stored Session definition.
- Closing a Session stops the PTY and removes it from sidebar navigation while
  retaining history.
- Closing a Workstream or Fork runs settlement and then archives its metadata.
- Deleting a Project stops active PTYs and deletes owned database records.

The schema is pre-release and intentionally optimized for the current model;
there is no compatibility promise yet.
