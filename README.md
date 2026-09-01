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
just app-dev
```

`app-dev` starts the native App with hot reload and keeps its state in the
repository-local `.treefold-dev/` directory. To develop against the normal
`~/.treefold` data instead, use:

```bash
just app-default
```

Both recipes use UI port `15011` and automatically choose an available API
port. Override either port when needed:

```bash
TREEFOLD_UI_PORT=15012 TREEFOLD_API_PORT=55001 just app-dev
```

Use `app-dev-no-watch` or `app-default-no-watch` when file watching is not
needed. The development data directory can also be overridden:

```bash
TREEFOLD_DEV_HOME=/tmp/treefold-dev just app-dev
```

Useful checks:

```bash
just check
just build
```

## CLI and Agent Skill

The desktop entry point is `treefold-app`. The separately built, lightweight
`treefold` CLI is bundled beside it for Treefold-managed Sessions:

```bash
treefold                  # top-level help
treefold open [path]      # explicitly open the App
treefold current --json
treefold todo list --json
treefold doctor
```

Treefold manages workspace identity and Todos. It intentionally does not store
per-turn Agent reports or wrap process commands. Persistent processes, TTYs,
logs, and restarts use the independent `amux` CLI and Skill.

The Treefold CLI Skill lives at [`cli/skills/treefold`](cli/skills/treefold).
The amux module owns its independent CLI and Skill; release builds stage both
from the selected amux source instead of keeping a Treefold copy.

At startup the App checks, without modifying the filesystem, whether the
bundled CLI and Skills are integrated. The lower-left Agent Integration panel
can create or synchronize these managed links:

```text
~/.local/bin/treefold          -> Treefold.app bundled CLI
~/.agents/skills/treefold      -> Treefold.app bundled Treefold Skill
~/.agents/skills/amux          -> Treefold.app bundled amux Skill
```

Treefold never overwrites an unmanaged path. The private bundled `amux` CLI is
not linked globally; managed Sessions receive the App's bundled binary directory
first on `PATH`, together with the explicit `TREEFOLD_*` and `AMUX_*` context.

Treefold stores its files under `~/.treefold` by default:

```text
~/.treefold/
├── config/settings.toml
├── data/
│   ├── treefold_1.sqlite
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
├── Rust/SQLx: asynchronous local project and session metadata
├── Rust/amux: persistent shell and Codex terminal processes
└── Git CLI: isolated Workspace worktrees
```

The amux control plane runs inside Treefold, while detached amux shims own the PTY
process groups. The GUI keeps private daemon/shim entry points, while the
user-facing `treefold` CLI and private `amux` CLI are separate bundled sidecars.
Frontend routes use hash history so deep links work from both Vite and packaged
assets.

### Database development

Treefold's current database generation is `1`. SQLx applies the immutable UTC
timestamped migrations in `src-tauri/migrations/g1` and uses
`_sqlx_migrations` for changes within that generation; SQLite `user_version` is
reserved for the generation number. The former `treefold.db` and its WAL/SHM
files are intentionally neither imported nor removed.

Install the matching SQLx CLI before changing persistence queries:

```sh
cargo install sqlx-cli --version 0.9.0 --no-default-features --features sqlite,rustls
cargo xtask database prepare
cargo xtask database check
```

Name new migrations `YYYYMMDDHHMMSS_description.sql` using UTC. Once committed,
a migration in a released generation is permanent and must never be edited or
squashed. Static SQL should use SQLx's checked macros; `database prepare`
rebuilds the committed `src-tauri/.sqlx` offline metadata using a disposable
generation 1 database, and `database check` verifies it without depending on a
developer database.

A future generation 2 must use `data/treefold_2.sqlite` and
`migrations/g2/`. It is built in a unique temporary file, populated by explicit
`g1 -> g2` conversion code, validated, closed, and atomically renamed. The
generation 1 file remains available for rollback; no manifest or symlink
selects the active database.

Create a release bundle with `npm run bundle:desktop`. Its thin Node entry point
invokes `cargo xtask sidecars bundle` to build the pinned CLI sidecars before
applying `src-tauri/tauri.bundle.conf.json`. The same Rust xtask prepares debug
sidecars for `npm run dev:desktop`, keeping Cargo target, profile, source, and
staging logic in one place. The default co-workspace layout expects the amux
repository at `../amux`; set `TREEFOLD_AMUX_MANIFEST` when its `Cargo.toml` lives
elsewhere. The xtask reads the amux package version and stages `skills/amux`
from that same module, so its CLI and Skill stay one release unit. Development
runs can override Skill discovery with `TREEFOLD_AMUX_SKILL_DIR`.

For a private local installation, build an ad-hoc signed App and DMG with a
SemVer-compatible timestamp such as `0.1.0-alpha.20260821153045`, then replace
`/Applications/Treefold.app` in one step:

```bash
just install-app-local
```

Quit an installed Treefold instance before running the recipe. Set
`TREEFOLD_BUILD_VERSION` to a valid SemVer value to make a build reproducible,
or `TREEFOLD_INSTALL_DIR` to install somewhere other than `/Applications`.

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
