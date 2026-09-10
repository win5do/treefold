# Treefold for macOS

**Run agents in parallel. Fold the work back cleanly.**

Treefold is a local-first macOS workspace for running Codex and Shell sessions
in managed Git worktrees. It keeps parallel work isolated while providing one
place to resume sessions, review progress, integrate changes, recover from
conflicts, and clean up completed work.

## What Treefold provides

- Isolated Workspaces and Forks backed by Git worktrees.
- Parallel Codex and Shell sessions that survive UI navigation and reconnects.
- Guided update, rebase, merge, delivery, recovery, and cleanup workflows.
- Project-level context directories and repository-aware agent authorization.
- Workspace Todos that agents can claim, update, block, and complete.
- A local CLI and Agent Skills for sharing Treefold context with coding agents.
- Local-first storage that remains on the user's Mac.

## Core model

A **Project** groups the repositories and context needed for a body of work. A
**Workspace** creates an isolated branch and worktree set for one change. A
**Fork** splits a Todo into parallel work that can later be folded back into its
parent Workspace. Each Workspace or Fork can own multiple persistent **Sessions**
and a shared Todo list.

Treefold owns the lifecycle around those objects: worktree creation, delivery,
rebase, recovery, and cleanup. Git remains visible and usable inside each
Workspace, while Treefold coordinates the operations that affect its managed
lifecycle.

## CLI and agent collaboration

The desktop App includes a lightweight `treefold` CLI and Treefold Agent Skill.
Managed sessions receive their current Project, Workspace, repository, and Todo
context automatically. Agents can inspect that context and collaborate through
the Todo lifecycle without storing conversational reports in Treefold.

Common entry points include:

```text
treefold open [path]
treefold current --json
treefold todo list --json
treefold doctor
```

Persistent processes and terminal sessions are managed by the companion `amux`
runtime and Skill. Treefold only creates managed CLI and Skill links when they
do not conflict with user-owned paths.

## Local-first architecture

```text
Treefold macOS App
├── Electron desktop shell and React UI
├── Rust HTTP/WebSocket API and persistent terminal runtime
├── Local SQLite project and session metadata
├── Managed Git worktrees
└── CLI and Agent Skills
```

Projects, Workspaces, Sessions, Todos, settings, and worktrees remain on the
local machine. Treefold does not require a hosted control plane for its core
workflow.

## Product documentation

Current product and architecture:

- [Product direction](docs/product-strategy.md)
- [Project and Workspace model](docs/project-workspace-model.md)
- [Git worktree lifecycle](docs/git-worktree-lifecycle.md)
- [Agent Skill, CLI, and App API architecture](docs/agent-skill-cli-api-architecture.md)
- [Frontend and backend communication](docs/frontend-backend-communication.md)
- [Positioning and messaging](docs/positioning-and-messaging.md)

Deferred designs, which are not runtime contracts:

- [Keymap configuration](docs/keymap-configuration-plan.md)
- [Codex App Server integration](docs/codex-app-server-future-integration.md)
- [Git History squash](docs/git-history-squash-design.md)


## Development and builds

On macOS, install stable Rust, Node.js 24.12+, Git, and just, then run
`npm install` once.

```bash
just app-dev  # Run locally with hot reload and isolated .treefold-dev data
just build    # Build a signed App and DMG in release/
```

See [AGENTS.md](AGENTS.md#development-environment-and-commands) for development,
testing, and local installation details.

## Preferences and shortcuts

Settings has separate Preferences and Keymap pages. Record a shortcut by pressing
a combination, disable it, or restore its default. Built-in Session shortcuts are
Cmd+T (new), Cmd+W (close), Ctrl+Tab (next), and Ctrl+Shift+Tab (previous).

`config/settings.toml` and `config/keymap.toml` under `$TREEFOLD_HOME` store only
user overrides. Missing keys follow defaults; `false` disables a key binding.
See [configuration details](docs/keymap-configuration-plan.md) for syntax and APIs.
