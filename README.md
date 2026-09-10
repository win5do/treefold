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

The desktop uses `electron-vite` for main/preload/renderer builds and
`electron-builder` for macOS packaging. React remains in `src/renderer/src/`; Electron
TypeScript lives in `src/main/` and `src/preload/`. `electron.vite.config.ts` shares the renderer
configuration in `vite.config.ts` with standalone browser tests.

```text
src/
├── main/          # Electron main process and Rust child supervisor
├── preload/       # Isolated desktop bridge
├── renderer/      # index.html + src/ React application
├── backend/       # Rust API, migrations and offline SQLx metadata
└── cli/           # Rust CLI and Treefold Skill
build/             # Icons and macOS signing entitlements
xtask/             # Repository build/database tooling
```

Rust crates retain their own `Cargo.toml`, `Cargo.lock`, and `src/` directories.
User configuration and runtime data remain outside the source tree.
`tsconfig.json` is the project-reference entry point; `tsconfig.node.json` checks
main/preload/build tooling and `tsconfig.web.json` checks the renderer.
`src/preload/bridge.d.ts` owns the shared desktop bridge contract, so Node code
never imports renderer implementation files for its types.

| Command | Purpose |
| --- | --- |
| `npm run dev` / `just app-dev` | Desktop development, isolated `.treefold-dev`, React HMR and main/preload/Rust watching |
| `npm run dev:no-watch` / `just app-dev-no-watch` | Desktop development without main/preload/Rust watching; renderer HMR remains available |
| `just app-default` | Intentionally use `~/.treefold` for desktop development |
| `npm run dev:web` / `just web-dev` | Browser-only Vite server; requires a separate API |
| `npm run typecheck` | Check application code, scripts, and tests |
| `npm run build` | Typecheck and build main/preload/renderer to `out/` |
| `npm start` | Preview the built desktop; prepare debug sidecars first with `cargo xtask sidecars dev` |
| `npm run build:web` | Build the standalone renderer to `dist/` |
| `npm run bundle:desktop` / `just build` | Build release Rust sidecars, desktop assets, signed App and DMG in `release/` |
| `just check` | TypeScript, SQLx metadata, Rust formatting and compilation |
| `just test` | Rust, standalone backend and deterministic browser tests |
| `just test-electron` | Packaged App and electron-vite development lifecycle tests; build the package first |
| `just install-app-local` | Build and replace the local installed App |

`TREEFOLD_HOME` takes priority over `TREEFOLD_DEV_HOME`; desktop development
otherwise defaults to `.treefold-dev`. UI port defaults to 15011 and the API
selects a free port. Use `TREEFOLD_UI_PORT` / `TREEFOLD_API_PORT` to override.

`scripts/rust-sidecars.ts` prepares and watches Rust inputs only during desktop
development. Electron-only changes do not run Cargo. electron-vite handles
main restarts and preload reloads. The main process waits for the previous
instance to finish shutting down its Rust child before acquiring its lock.

Packaging, local installation, and test entry points use TypeScript
and run directly with Node.js 24.12+ type stripping. No separate TS runner or
precompilation is required. Use explicit `.ts` runtime imports and `import type`
for types; avoid enums, parameter properties, and other syntax that requires
transformation. `npm run typecheck` checks these files separately because Node
does not check types. UI tests also typecheck their browser-side Vite imports.
`electron-builder.yml` owns ad-hoc signing, entitlements, and strict signature
verification through electron-builder's built-in macOS signer. No custom signing
hook is needed. Packaging and `just install-app-local` share one builder API
entry point and SemVer validation. Local installs default to a UTC timestamped
version; `TREEFOLD_BUILD_VERSION` overrides it. Installation verifies a temporary
copy before replacing the old App, and restores the old App if replacement fails.
`TREEFOLD_INSTALL_DIR` can select an isolated installation directory.

Electron main/preload source remains TS, with `.cjs` build output for the
desktop runtime. electron-vite 5 currently supports Vite 5–7, so this
project uses Vite 7 with the compatible React plugin 5.
