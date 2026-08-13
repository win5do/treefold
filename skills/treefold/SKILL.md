---
name: treefold
description: Read context and manage eligible Todos in a Treefold-managed Workspace or Fork Session through the `treefold` CLI. Use when `TREEFOLD_SESSION_ID` is present, when a user asks about the current Treefold scope or target, or when Workspace/Fork work should be claimed, released, completed, blocked, created, edited, or removed in Treefold.
---

# Treefold

Use Treefold as the management layer for Project, Workspace, and Fork identity and for development Todos. Managed Agent Sessions belong to Workspace or Fork. Keep reasoning, work summaries, verification details, and conversational memory in the Agent Session; do not copy them into Treefold.

## Read current context

Run this once near the start of work when Treefold context is relevant:

```bash
treefold current --json
```

Treat the response as current runtime data. Re-read Git state with Git before destructive or history-changing operations because the snapshot can become stale.

If `TREEFOLD_SESSION_ID` is absent, do not assume the current directory belongs to Treefold. Use `treefold doctor` only when diagnosing setup or connectivity.

## Manage Todos

Todos are available in Workspace and Fork Sessions. Project Open Shell/Open
Codex processes are unmanaged external tools and do not receive Treefold Session
context.

List and inspect work assigned to the current Workspace:

```bash
treefold todo list --json
treefold todo show <todo-id> --json
```

Use explicit management transitions:

```bash
treefold todo add "Title" --description "Details"
treefold todo edit <todo-id> --title "New title" --description "New details"
treefold todo claim <todo-id>
treefold todo release <todo-id>
treefold todo done <todo-id>
treefold todo block <todo-id> --reason "Concise blocking condition"
treefold todo remove <todo-id>
```

- Claim a Todo only when starting that Todo.
- Treat claim conflicts as evidence that another Session owns it.
- Mark a Todo done only after its requested outcome is complete.
- Block only on a real condition that prevents progress; keep the reason concise.
- Remove a Todo only on explicit user intent because removal is permanent.
- Do not send periodic progress updates or per-turn summaries to Treefold.

## Manage processes with amux

Use the independent `$amux` skill and `amux` CLI for processes, TTYs, logs, signals, and restarts. Treefold injects `AMUX_SOCKET`, `AMUX_STATE_DIR`, and `AMUX_WORKSPACE` so amux connects to the Treefold-owned runtime for the current physical workspace.

Do not look for `treefold service`, `treefold logs`, or Treefold child-Agent commands; they do not exist. Do not stop, restart, or remove the current Session process identified by `AMUX_PROCESS_ID`.

## Respect lifecycle ownership

Treefold owns managed worktree creation, rebase, reset, delivery, cleanup, and Session lifecycle. Do not invoke those lifecycle actions merely as part of task completion. Normal edits, commits, tests, and user-requested Git work inside the active workspace remain allowed.

If the Treefold App/API is unavailable, continue safe local work when possible and tell the user that Todo synchronization could not be completed.
