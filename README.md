# Treefold for macOS

**Run agents in parallel. Fold the work back cleanly.**

Treefold is a local-first macOS workspace for running Codex and Shell sessions
in managed Git worktrees, with resume, rebase, recovery, merge, and cleanup.
The UI is React + Vite inside Tauri's system WebView; projects, workspaces,
SQLite data, and Git worktrees are managed by the Rust backend. Persistent PTY
processes are managed by the local Rust `amux` runtime.

## Requirements

- macOS
- Rust stable
- Node.js 24+
- `git` on `PATH`
- `codex` on `PATH` to create Codex sessions
- `just` (optional)

## Development

```bash
npm install
npm run dev:desktop
```

Development launches automatically choose an available API port in the
`50001-59999` range and provide it to both the Rust API and browser-side Vite
requests. Open the `[treefold dev] UI:` URL printed by the command in an
external browser. To request a specific API port, set:

```bash
TREEFOLD_API_PORT=55001 just app-default
```

The available-port helper can also be called independently:

```bash
node scripts/random-port.mjs
```

Or from the repository root:

```bash
just install
just dev
```

The `just dev` and `just dev-no-watch` recipes keep development state in the
repository-local `.treefold-dev/` directory, separate from the normal
`~/.treefold` installation. Development UI launches use loopback port `15011`
for the Vite dev server. Development launches select the API port before Vite
starts so the external browser and Rust backend share the same address. Packaged
builds ask the operating system for a free loopback API port and inject the
resulting URL into the WebView and Treefold-managed terminal sessions. Set
`TREEFOLD_DEV_HOME` to use another development state directory:

```bash
TREEFOLD_DEV_HOME=/tmp/treefold-dev just dev
```

`tauri dev` starts Vite with hot reload, compiles the Rust backend, and opens
the native macOS window. The selected backend URL is published at
`$TREEFOLD_HOME/runtime/api-url` for local CLI discovery. Set
`TREEFOLD_API_ADDR` to request a specific loopback bind address instead.

Useful checks:

```bash
just check
just build
```

## CLI and Agent Skill

The packaged `treefold` executable is both the desktop entry point and a thin
CLI for Treefold-managed Sessions:

```bash
treefold
treefold current --json
treefold todo list --json
treefold todo claim <todo-id>
treefold todo done <todo-id>
treefold doctor
```

Treefold manages workspace identity and Todos. It intentionally does not store
per-turn Agent reports or wrap process commands. Persistent processes, TTYs,
logs, and restarts use the independent `amux` CLI and Skill.

The distributable Codex Skill lives at [`skills/treefold`](skills/treefold).
Install or link that directory as `treefold` in the active Codex skills home.
The Skill expects managed Sessions to provide the `TREEFOLD_*` and `AMUX_*`
environment variables injected by the App.

Treefold stores its files under `~/.treefold` by default:

```text
~/.treefold/
├── config/settings.toml
├── data/
│   ├── treefold.db
│   └── amux/
└── git/
    ├── s/<project-id>/<repository-slug>/
    └── w/<workspace-id>/<repository-slug>/
```

Set `TREEFOLD_HOME` before starting the app to relocate this complete tree. The
settings file owns durable user preferences (`language` and agent launch
defaults); SQLite owns Projects, Workspaces, Sessions, Todos, and
operation records. Treefold creates `settings.toml` with `schema_version = 1` on
first launch. Configuration changes made outside the app are picked up on the
next settings read; invalid or unsupported schemas are reported instead of
being rewritten. `extra_args` defaults to an empty list; to make new Codex
Sessions default to bypassing approvals and sandboxing, configure:

```toml
schema_version = 1
language = "system"

[agents.codex]
extra_args = ["--dangerously-bypass-approvals-and-sandbox"]
```

Clients update selected fields with `PATCH /api/settings`; fields omitted from
the request and unknown keys already present in the file are preserved.

## Architecture

```text
Tauri macOS process
├── WKWebView: React + Vite + xterm.js
├── Rust/Axum: loopback REST + terminal WebSocket
├── Rust/rusqlite: local project and session metadata
├── Rust/amux: persistent shell and Codex terminal processes
└── Git CLI: isolated Workspace worktrees
```

The amux control plane runs inside Treefold, while detached amux shims own the PTY
process groups. The Treefold executable exposes the shim as a hidden entry point,
so no separately installed sidecar is required. Frontend routes use hash history
so deep links work from both Vite and packaged assets.

## Product documentation

- [Product direction](docs/product-strategy.md)
- [Project and Workspace model](docs/project-workspace-model.md)
- [Git worktree lifecycle](docs/git-worktree-lifecycle.md)
- [Keymap configuration plan](docs/keymap-configuration-plan.md)
- [Agent Skill, CLI, and App API architecture](docs/agent-skill-cli-api-architecture.md)
- [Frontend and backend communication](docs/frontend-backend-communication.md)
- [Positioning and messaging](docs/positioning-and-messaging.md)
