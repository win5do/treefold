# Project Sessions

Project pages create Shell and Codex Sessions in Treefold's Web terminal. They
run directly in the selected Project Directory and use an internal `base`
Workspace only as a process and persistence owner. That internal record is not
shown as a development Workspace and never owns Todos or delivery state.

Project Codex Sessions are retained so they can be reopened and resumed. Other
ready Git locations are writable additional directories; non-Git locations are
read-only context. The UI warns that Project Codex operates directly in the
user's repositories without Workspace worktree or delivery protection.

Shell Sessions are ephemeral in Projects, Workspaces, and Forks. Treefold keeps
their records only while the process is active so navigation can reconnect to
the terminal. Closing a Shell removes both the terminal process and database
record, and completed Shells are pruned instead of appearing in Session history.
