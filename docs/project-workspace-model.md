# Project, Workspace, Fork, and Session

Treefold uses a shallow development hierarchy:

```text
Project
├── Session
└── Workspace
    ├── Session
    ├── Todo
    └── Fork
        ├── Session
        └── Todo
```

Every level can create formal Shell or Codex Sessions. The levels differ in
their Git ownership, not in whether they can host a terminal.

## Project

A Project is a registered Git repository, not a development branch. It owns the
source checkout, Git common directory, remotes, default target branch, default
delivery mode, and the inventory of Workspaces and worktrees.

Project Sessions run in the source checkout and are recorded, resumed, stopped,
and archived like other Sessions. They are an explicit escape hatch for
repository-level work: the user owns the effects of commands run there.

Project Pull fetches the preferred remote target and fast-forwards only when the
source checkout is clean and currently on that target. Project Push pushes that
target without force.

## Workspace

A Workspace is one feature, fix, or other deliverable body of work. It owns a
managed worktree, local feature branch, fixed target and creation commit,
optional remote feature branch, delivery state, Sessions, Todos, and Forks.

Workspace Pull fast-forwards its configured upstream only. Workspace Push sets
the upstream and pushes without force. The local and remote branch names are
independent.

## Fork

A Fork is one level of parallel subwork beneath a Workspace. It starts from the
parent Workspace's current HEAD and owns its own managed worktree, local branch,
Sessions, and Todos. Forks cannot nest.

A Fork has no remote branch, Pull, or Push. Finishing it performs a local merge
into the parent Workspace. The parent remains responsible for remote
synchronization and final delivery.

## Session

A Session belongs directly to a Project, Workspace, or Fork. Internally,
Project Sessions use a hidden in-place runtime owner so the persistence and PTY
lifecycle stay uniform; this is an implementation detail, not a visible
development Workspace.

Shell Sessions run the login shell. Codex Sessions run Codex with their owner's
checkout as primary context. Treefold records lifecycle state and can stop,
restart, hide, and resume both kinds.

## Finishing

A root Workspace can verify a remote-reviewed merge, merge locally into its
fixed target with an optional push, preserve its work, or discard it. Active
Forks must be finished first.

A Fork can merge locally into its parent Workspace, preserve its work, or
discard it. It cannot claim a remote merge or push after merge. All delivery
paths use preflight validation and delay cleanup until the selected outcome is
proven.
