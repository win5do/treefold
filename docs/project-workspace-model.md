# Project, Workspace, Fork, and Session

Treefold uses a shallow development hierarchy:

```text
Project
└── Workspace
    ├── Session
    ├── Todo
    └── Fork
        ├── Session
        └── Todo
```

Workspace and Fork can create formal Shell or Codex Sessions. Project exposes
unmanaged external tools instead of owning development Sessions.

## Project

A Project is a registered Git repository, not a development branch. It owns the
source checkout, Git common directory, remotes, default target branch, default
delivery mode, and the inventory of Workspaces and worktrees.

`Open Shell` and `Open Codex` launch unrestricted external tools in the source
checkout. Treefold does not record, resume, stop, archive, or attach those
processes to delivery. The user owns the effects of commands run there.

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

A Session belongs directly to a Workspace or Fork.

Shell Sessions run the login shell. Codex Sessions run Codex with their owner's
checkout as primary context. Treefold records lifecycle state and can stop,
restart, hide, and resume both kinds.

## Finishing

A root Workspace can verify a remote-reviewed merge, merge locally into its
fixed target with an optional push, preserve its work, or discard it. Active
Forks must be finished first.

A Fork can merge locally into its parent Workspace, preserve its work, or
discard it. By default its Todos are carried into the parent Workspace;
assigned, in-progress, or blocked work returns to pending while completed work
stays completed. A Fork cannot claim a remote merge or push after merge. All
delivery paths use preflight validation and delay cleanup until the selected
outcome is proven.
