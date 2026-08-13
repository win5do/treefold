# Project Unmanaged Tools

Project pages expose `Open Shell` and `Open Codex` for repository maintenance.
These actions open an unrestricted external terminal in the selected Project
directory and do not create a Treefold Session, hidden Workspace, Todo owner, or
delivery record.

This is an intentional escape hatch. Users may fetch, inspect, repair, or make
direct changes in the source checkout and are responsible for those operations.
Treefold's managed Workspace safety remains independent: creation fixes a target
and start commit, and pull, rebase, finish, and cleanup validate actual Git state
when they run.

Only Workspace and Fork pages can create formal Shell or Codex Sessions. This
preserves the invariant that every managed Session belongs to a development
unit.
