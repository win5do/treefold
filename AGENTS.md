# Repository Instructions

## Module boundaries

Keep feature ownership explicit and prevent shared entry points from becoming
cross-domain implementation files.

### Frontend modules

- `src/renderer/src/App.tsx` owns route composition, lazy-loading boundaries, and top-level
  application assembly only. Put queries, mutations, dialogs, and page content
  in their owning `src/renderer/src/features/*` or `src/renderer/src/app/*` module.
- Co-locate feature-specific API adapters, state hooks, and view components.
  Do not route unrelated feature state through `App.tsx` merely to share it.
- Do not keep extending a component with a flat list of cross-domain callback
  props. Group cohesive actions behind feature-owned hooks or action objects.
- Treat Project, Workspace, Session, Git, and Settings as separate feature
  boundaries even when one screen composes several of them.

### UI-test modules

- `tests/ui/ui-harness.ts` is a compatibility entry point. Harness lifecycle,
  fixture state, and feature route handlers belong in `tests/ui/harness/*`.
- Keep fixture API handlers grouped by feature. A new API domain must not add a
  new branch to one repository-wide request handler.
- Prefer composable fixture builders and scenario overrides over adding every
  state to `tests/ui/fixtures/sidebar-core.ts`.
- `npm run test:ui` must invoke the stable test runner. Adding a new test must
  not require editing the package script.

### Rust modules and models

- Use Rust `mod` declarations and normal module files. Do not add `include!`
  based server or model modules.
- Each server feature owns its routes and handlers. Keep HTTP extraction and
  response conversion in handlers, and put reusable behavior in explicit
  service functions.
- Dependencies between server features must be explicit through module paths or
  deliberately scoped exports, not accidental access to one shared lexical
  namespace.
- Keep API DTOs, persistence records, and internal operation state distinct.
  Add models to their owning domain module and re-export only intentional public
  contracts from `model/mod.rs`.

### Refactoring discipline

- Module-only refactors must preserve HTTP contracts, database schemas, and
  user-visible behavior.
- Keep file moves, behavior changes, and broad formatting changes in separate
  commits when practical.
- Finish each refactoring stage with a buildable, tested main branch; do not
  leave temporary duplicate implementations or compatibility shims without an
  explicit follow-up in the same task.

## Development environment and commands

Treefold development targets macOS and requires stable Rust, Node.js 24.12 or
newer, Git, and Codex when exercising Codex Sessions. `just` is the preferred
task runner but is optional.

- Run `npm install` once to install frontend and desktop tooling.
- `just` owns developer entry points, standalone Cargo tasks, and check/test
  composition. npm scripts own TypeScript, frontend, and Electron tool commands.
  TS scripts own version propagation, artifact paths, and installation rollback.
  Keep calls directed from just to npm/Cargo/TS; npm scripts must not invoke just.
- `npm run dev` uses electron-vite for desktop development.
  `npm run build` builds main/preload/renderer
  to `out/`; `npm run typecheck` checks application code, scripts, and tests.
- Run standalone scripts with Node type stripping (`node file.ts`).
  Playwright Test loads UI/Electron test TypeScript through its runner.
  Keep runtime imports explicit (`./file.ts`), use type-only imports for types,
  and avoid syntax requiring transformation. Node does not run type checks.
  `tsconfig.tools.json` checks direct Node entry points; `tsconfig.ui-tests.json`
  also resolves browser-only Vite imports inside UI-test callbacks.
- Run `just app-dev` for hot reload with repository-local state under
  `.treefold-dev/`; use `just app-default` only when intentionally developing
  against `~/.treefold`.
- `TREEFOLD_DEV_HOME` relocates development state. `TREEFOLD_UI_PORT` and
  `TREEFOLD_API_PORT` override the default development ports `15011` and an
  automatically selected API port.
- Use `app-dev-no-watch` or `app-default-no-watch` when main/preload/Rust watching is not
  needed; renderer HMR remains enabled.
- Run `just --list` to discover tasks, `just check` for the standard validation
  set, and `just build` for a full application build. `just typecheck` runs only
  TypeScript checks; `just check-backend` checks Rust formatting and compilation.
- Run `just test` for Rust, backend lifecycle/install, and deterministic Electron UI
  tests. `just test-backend`, `just test-integration`, and `just test-ui` run individual
  suites. `just test-integration` builds the backend prerequisite; the underlying
  `npm run test:integration` runs only the backend/install tests.
- `just build-backend` builds the standalone backend. `just prepare-sidecars`
  prepares debug sidecars; pass `bundle` for release sidecars. `npm start`
  previews compiled desktop assets after debug sidecars have been prepared.
- `scripts/rust-sidecars.ts` prepares and watches Rust inputs during development.
  Electron-only changes do not run Cargo. electron-vite handles main restarts and
  preload reloads; the main process waits for the previous instance's Rust child
  to stop before acquiring its lock.

### SQLx development workflow

Install the SQLx 0.9 CLI with SQLite support before changing migrations or
compile-time checked queries:

```bash
cargo install sqlx-cli --version 0.9.0 --no-default-features --features sqlite,rustls
```

- Run `just database-prepare` after changing a migration or SQLx query
  macro and commit the resulting `src/backend/.sqlx` metadata.
- Run `just database-check` to verify migrations and offline metadata
  against a disposable database. Normal builds must not require a developer
  database or `DATABASE_URL`.
- Prefer `query!` and `query_as!` for static SQL. Use runtime query APIs only
  when the SQL shape is genuinely dynamic.
- Name migrations with UTC `YYYYMMDDHHMMSS_description.sql` versions.

### Desktop build and sidecars

- `electron-vite` builds main/preload/renderer assets; `electron-builder` packages
  macOS apps. `electron.vite.config.ts` shares renderer configuration from
  `vite.config.ts` with deterministic Electron UI tests.
- React lives in `src/renderer/src/`, Rust CLI code in `src/cli/`, icons and signing
  entitlements in `build/`, and repository Rust tooling in `xtask/`.
  Rust crates retain their own `Cargo.toml`, `Cargo.lock`, and `src/` directories.
- `tsconfig.json` is the project-reference entry point. `tsconfig.node.json`
  checks main/preload/build tooling; `tsconfig.web.json` checks the renderer.
  `src/preload/bridge.d.ts` owns the shared desktop bridge contract; Node code
  must not import renderer implementation files for types.
- Main/preload source is TypeScript with `.cjs` runtime build output.
  electron-vite 5 supports Vite 5–7; this project uses Vite 7 and React plugin 5.

- `src/main/` and `src/preload/` own the desktop main process, sandboxed preload
  bridge, and backend process supervision. `src/backend/` owns the Rust
  HTTP/WebSocket service and all business state. Keep business behavior out of Electron IPC handlers.
- `just build` produces the macOS App and DMG under `release/`.
  Use electron-builder's built-in macOS signing configured in `electron-builder.yml`;
  do not duplicate its signing pipeline in a custom script. The build and local
  install entry points share `bundleApp()` in `scripts/bundle-app.ts` for
  SemVer validation, version propagation, and artifact paths. Keep its Cargo
  calls inside that workflow so sidecars and Electron share one build version.
  `just test-integration` builds and validates the Rust process lifecycle.
  `just test-electron` validates the packaged App and electron-vite development
  lifecycle with isolated homes; build the package first.
- `just build` invokes `cargo xtask sidecars bundle` before applying
  the Electron bundle configuration.
- Development runs prepare debug sidecars through the same xtask workflow. The
  default co-workspace layout resolves amux from `../amux`; override it with
  `TREEFOLD_AMUX_MANIFEST` and override Skill discovery with
  `TREEFOLD_AMUX_SKILL_DIR` only when necessary.
- Stage the amux binary, version, and `skills/amux` from the same selected amux
  source so they remain one release unit.
- Run `just install-app-local` to build an ad-hoc signed App and DMG and replace
  the local installation. Quit an installed Treefold instance first.
  `TREEFOLD_BUILD_VERSION` supplies a reproducible SemVer build value and
  `TREEFOLD_INSTALL_DIR` changes the destination from `/Applications`.
  Local installs default to a UTC timestamped version. Installation validates a
  temporary copy before replacing the old App and restores it if replacement
  fails.

## Configuration and persistence ownership

Keep user-authored configuration and application-owned state separated by a
hard storage boundary.

- `$TREEFOLD_HOME` selects the complete Treefold root before any configuration is
  read. It defaults to `~/.treefold`; a TOML file inside that root must not attempt
  to relocate its own root.
- Durable user preferences belong in
  `$TREEFOLD_HOME/config/settings.toml`. This file must contain
  `schema_version`, and currently owns `language`, `worktree_root`, and agent
  defaults such as `agents.codex.extra_args`.
- Key bindings will belong in the independent
  `$TREEFOLD_HOME/config/keymap.toml` described in
  `docs/keymap-configuration-plan.md`. Do not implement or store keymaps until
  that deferred feature is explicitly requested.
- `$TREEFOLD_HOME/data/treefold_<generation>.sqlite` owns Projects, Directories, Workspaces,
  Sessions, Todos, delivery/rebase/reset operations, and similar relational
  runtime records. Do not add user preferences or keymaps to SQLite.
- Persisted random entity IDs use the shared UUID v7 generator and remain
  lowercase 32-character `TEXT`. Stable composite IDs such as Project base
  Workspace IDs remain strings and must not be replaced with random UUIDs.
- SQLx migrations live in the active generation directory, currently
  `src/backend/migrations/g1`, and use UTC timestamp filenames. SQLx's
  `_sqlx_migrations` owns within-generation history; `PRAGMA user_version` is
  reserved for the database generation. Domain tables must use SQLite `STRICT`
  mode. Never add startup-time ad-hoc `ALTER`, `DROP`, or data-rewrite logic
  outside those migrations.
- Treat every committed SQLite migration as immutable, including during
  pre-release development. For every schema or data change—including adding a
  column, constraint, index, or backfill—append a timestamped forward-only
  migration; never edit or squash a migration in a published generation.
- A major generation gets a new fixed database filename and independent
  migration directory. Create and validate the target in a unique temporary
  file, copy data through explicit generation conversion code, then atomically
  rename it. Preserve the prior generation for rollback. The binary's fixed
  generation constant selects the active file; do not introduce a manifest or
  symlink. Legacy `treefold.db` files predate generation 1 and are ignored
  without being modified or removed.
- Temporary UI state may use SQLite or frontend local storage. Caches and
  derived data may use SQLite or a future cache directory, but neither is a
  source of truth for user preferences.
- Tokens and secrets belong in the platform Keychain, never TOML or SQLite.
- A setting must have exactly one writable source of truth. UI edits to TOML
  settings must go through the backend and must not be mirrored into SQLite.
- Update individual preferences through the generic `PATCH /api/settings`
  resource. Do not add one endpoint per setting and do not require clients to
  submit an all-settings snapshot; unspecified and unknown file keys must be
  preserved.
- Settings-file writes must be atomic. Reject unsupported `schema_version`
  values without rewriting the file. Add explicit sequential migrations before
  supporting a second schema version.

## Frontend UI conventions

Treefold uses shadcn/ui with Base UI (`base-mira`), Tailwind CSS v4, the Neutral
CSS-variable theme, Lucide icons, and Inter. Treat `components.json` as the
source of truth for this configuration.

- Reuse `src/renderer/src/components/ui` primitives and built-in variants before writing
  custom controls or styles. Import them through `@/components/ui/*`.
- Add components with `npx shadcn@latest`; inspect installed-component updates
  with `--dry-run` and `--diff` before changing local source.
- Keep direct `@base-ui/react` usage inside shared UI primitives. Use Base UI's
  `render` composition API, not Radix-only `asChild` examples.
- In new or touched application UI, use semantic color tokens rather than raw
  palette or hex colors. Keep reusable visual variants in shared components and
  use feature-level `className` primarily for layout.
- Use Lucide exclusively for application icons. Button icons use `data-icon`
  and inherit sizing from the component; standalone icons use `size-*`.
- Use `Field` primitives for forms, expose validation with `aria-invalid`, and
  give every dialog an accessible title.

## UI verification workflow

Treefold UI tests use Playwright Test with Electron, with no standalone Chrome
or WebDriver transport. `playwright.config.ts` owns automatic test discovery and
serial execution. `npm run test:ui` runs deterministic UI scenarios in an Electron
BrowserWindow with the production preload and fixture API. `npm run test:electron`
runs packaged App and development lifecycle coverage against the real main process.
Rust unit tests remain in Cargo. Standalone backend and installation tests use
the Playwright `integration` project without launching a renderer.

### Default checks

1. Run `just typecheck` after every TypeScript or React change.
2. Run `npm run build` for dependency, production build, substantial frontend,
   routing, or broad layout changes.
3. Run `just test-ui` for user-visible behavior changes and broader frontend work.
   Use focused Playwright Electron diagnostics and screenshots for presentation
   changes that do not pass the automated test admission gate below.
4. For main process, native integration, or lifecycle changes, run
   `just test-electron` after building the current App with `just build`.

Do not use Computer Use or perform manual desktop acceptance unless explicitly
requested. Automated Electron runs use isolated temporary homes. Report passed
commands, exercised Electron scenarios, and any remaining verification gaps.

### Deterministic UI fixture

`npm run test:ui` must be self-contained by default. It must not depend on the user's Treefold database, existing Projects, fixed local directories, Git worktrees, or an already-running Electron backend.

- `tests/ui/ui-harness.ts` starts the fixture API and renderer asset server on
  ephemeral ports. Vite serves assets inside Electron; tests do not launch Chrome.
- `tests/ui/harness/session.ts` launches Electron through Playwright with a
  test-only main process, the production preload, and a unique temporary userData
  directory. Close the Electron application and both servers in `finally`, and
  remove temporary builds and data. Test main-process handlers must remain inert;
  production IPC and backend lifecycle are covered by `tests/electron/`.
- UI cases use native Playwright Page/Locator APIs. Do not add WebDriver adapters
  or browser transport switches. Add `tests/ui/*.spec.ts` cases without changing
  npm scripts.
- `tests/ui/fixtures/sidebar-core.ts` owns fixed IDs, timestamps, names, and API responses for the sidebar core flow.
- The fixture API must reject and record unimplemented requests so a new frontend dependency cannot silently pass.
- Use inert fixture Sessions; UI layout tests must not launch real Shell or Codex processes.
- Keep fixture data deterministic and include relevant stress states such as long labels, active and archived records, nested tree rows, and empty collections.
- Do not weaken fixture data or assertions merely to make a regression pass. Update them only when the intended product behavior changes.

Do not connect UI tests to an external UI URL or user data. Each run creates its own fixture API and Electron session.

### Playwright core flow

Keep `tests/ui/sidebar.core.spec.ts` small and focused on stable, high-value behavior. Do not add a new feature domain to this core flow. Split or replace legacy cross-domain coverage before extending it, and do not treat existing broad coverage as precedent for appending more scenarios.

#### Automated UI-test admission gate

Add or update an automated UI test only when the regression would change at least one of these durable contracts:

- navigation, persisted state, or an API side effect;
- permissions, availability, disabled state, or contextual visibility;
- creation, update, deletion, or lifecycle behavior;
- keyboard behavior or another accessibility semantic;
- shared overlay reachability or occlusion behavior covered under the representative-overlay rules below.

Do not add or update automated tests for presentation-only changes, including spacing, alignment, centering, dimensions, colors, typography, icon placement, animation names, static copy, or visual hierarchy. A useful test must survive a pure CSS refactor that preserves behavior and accessibility. Verify presentation changes with focused Playwright Electron diagnostics and screenshots. Inspect the current Treefold App only when the user explicitly requests manual App verification.

Outside the representative overlay helper, automated tests must not assert exact pixels, element coordinates, computed CSS properties, DOM sibling order, or animation implementation details. Do not use `getLocation`, `getSize`, `getCSSProperty`, or `compareDocumentPosition` to encode visual design. Functional resize limits may assert the resulting persisted value, but not incidental page offsets.

Do not retain permanent "tombstone" assertions that merely prove a removed label, field, or control is absent. Keep a negative assertion only when absence enforces a current permission, data-ownership, safety, or contextual-visibility contract. Remove transitional assertions once the migration they protect is complete.

Before adding a UI assertion, identify the concrete user-visible failure it detects and confirm that existing coverage does not already detect it. Cover shared components and interaction models once with a representative stress case; usage sites should assert only their distinct business behavior. Prefer unit, API, or contract tests when a renderer is not required.

Prefer semantic locators such as roles, accessible names, and labels, followed by stable `data-testid` attributes. Do not locate controls by fragile DOM depth or absolute screen coordinates.

Core assertions should cover the applicable behavior:

- controls appear only in the correct Project, Workspace, or Session context;
- sidebar controls perform show, hide, resize, and tree expansion actions;
- long labels preserve accessible names and do not make required actions unreachable;
- contextual panels and primary navigation open and close correctly;
- archived records stay out of active navigation while retained history remains available where intended.

### Floating overlay verification

Add or extend automated overlay coverage only when a shared overlay implementation changes or a regression can make actions clipped, occluded, or unreachable. Test one representative stress instance per shared overlay implementation or distinct interaction model; do not repeat the same geometry and pointer trajectory for every menu usage.

- Exercise the pointer and keyboard trajectories relevant to that shared interaction model, including applicable child-overlay movement, outside click, Escape, and keyboard navigation. Do not duplicate the same trajectory across usage sites.
- Render overlays that must escape scroll containers or stacking contexts through a document-level portal. Do not rely on a larger `z-index` to escape an ancestor's `overflow`, transform, containment, or stacking context.
- At one representative viewport-edge stress position, assert overlay bounds remain inside the viewport. Add another geometry case only for a distinct positioning algorithm.
- Verify actual paint-order reachability with `document.elementFromPoint()` at the center and inset corners of each overlay surface. The expected overlay must own every sampled hit; this catches clipping and occlusion that visibility APIs miss.
- Capture and inspect screenshots whenever the risk involves clipping, overlap, alignment, stacking, animation, or hierarchy. A DOM snapshot may complement but cannot replace the screenshot for these risks.
- Keep geometry and hit-testing inside a small reusable overlay helper so the same acceptance checks apply to future overlays without spreading coordinate assertions through feature tests.

The Electron application and all harness services must always be closed. Save a failure screenshot under `/tmp` when practical.

### Electron diagnostics and optional desktop App acceptance

Use Playwright's Electron Page for DOM and accessibility inspection, computed
layout, hit testing, screenshots, and console errors. Presentation-only diagnosis
can use a focused temporary Electron scenario without adding permanent assertions.
Use the deterministic fixture unless the issue requires the real backend; in that
case use an isolated home and the current build.

Only when the user explicitly requests manual App acceptance, launch or connect
to a Treefold desktop App built from the current working revision and inspect the
change as a user would. Use an isolated `TREEFOLD_HOME` whenever the acceptance
flow could mutate persistent application data. Avoid validating against a stale
packaged App or an unrelated already-running dev process. In that requested App
acceptance pass:

- If a Treefold dev App already opened by the user blocks the acceptance run (for example, by holding an application or server port), the agent may identify and terminate that specific dev App and its owned child processes before launching the current revision. Resolve exact process IDs first and do not terminate unrelated applications or development servers.
- exercise each changed state, including applicable expanded, collapsed, empty, long-label, and contextual states;
- inspect App screenshots when spacing, clipping, overlap, hierarchy, typography, color, or alignment matters;
- perform the real pointer, keyboard, focus, scrolling, menu, and window interactions affected by the change;
- verify persistent controls remain reachable after panels are hidden;
- confirm contextual controls do not leak into unrelated routes;
- watch the desktop dev-process output for runtime errors when available.

For important platform-sensitive interactions—including drag and drop, pointer
capture, focus transfer, keyboard shortcuts, IME, clipboard behavior, context
menus, scrolling, file drops, and renderer-dependent event behavior—prefer a
focused automated Electron UI test when practical. Exercise them manually in the
desktop App only when the user explicitly requests it. If a requested App
acceptance pass disagrees with automated Electron results, report the
disagreement and treat the real App result as authoritative.

If exploration reveals a stable and mechanically testable regression risk, add automated coverage only when it passes the admission gate above. Presentation regressions must not be converted into pixel or CSS assertions.

### Electron-specific changes

For important logic involving the native title bar, window controls, menus,
filesystem dialogs, terminal integration, or other Electron APIs, use focused Electron
UI test coverage when it can exercise the affected contract. Do not run
`npm run dev`, use Computer Use, or perform manual real-App acceptance
unless the user explicitly requests it.
