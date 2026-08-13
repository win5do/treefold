# Project, Workspace, and Session

Treefold uses one development hierarchy:

```text
Project
└── Workspace
    ├── Session
    └── Todo
```

## Project

A Project is a registered Git repository, not a development branch. It owns
repository metadata and defaults:

- the source checkout and absolute Git common directory;
- registered directories and remotes;
- the preferred remote and default target branch;
- the default delivery mode;
- the inventory of Workspaces and Git worktrees.

A Project does not own formal Sessions or Todos. `Open Shell` and `Open Codex`
launch an unmanaged external terminal in the source checkout. Treefold does not
record, resume, stop, archive, or attach those processes to a delivery.

Project Pull fetches the preferred remote's target branch and applies only a
fast-forward in a clean source checkout currently on the target branch. Project
Push pushes that target branch without force.

## Workspace

A Workspace is one feature, fix, or other deliverable body of work. It owns:

- a managed Git worktree;
- a locally unique feature branch;
- a fixed target branch and creation commit;
- an optional remote name and remote feature branch;
- a delivery mode and delivery status;
- managed Shell/Codex Sessions and Todos.

The local branch may be supplied by the user. Otherwise Treefold generates a
readable `treefold/<slug>-<random>` branch. The remote branch is independent of
the local branch and can be configured or cleared later.

Workspace Pull fetches its configured upstream and fast-forwards only. If local
and remote have diverged, Treefold stops and asks the user to rebase or merge
explicitly. Workspace Push sets the upstream and pushes without force.

## Session

A Session always belongs to a Workspace. Shell Sessions run the login shell;
Codex Sessions run Codex with the Workspace worktree as their primary context.
Treefold records lifecycle state and can stop, restart, hide, and resume these
managed processes.

## Finishing a Workspace

Finishing delivers to the Workspace's fixed target rather than to a mutable
Project working state. Preflight snapshots source and target state before any
mutation. Four outcomes are supported:

1. **Remote merged**: verify the Workspace head is reachable from the fetched
   remote target after review and CI.
2. **Local merge**: merge into the clean local target checkout, optionally push
   the target branch, then clean up.
3. **Preserve**: keep the Workspace, worktree, and branch for later work.
4. **Discard**: explicitly remove the worktree and branch without delivery.

Todos may be kept in the archived Workspace or discarded; they are never
implicitly moved to Project. Session history may be retained. Cleanup happens
only after delivery verification, and an interrupted operation remains
recoverable.

Fork is intentionally not part of the active model. Parallel development is
represented by sibling Workspaces under the same Project.
