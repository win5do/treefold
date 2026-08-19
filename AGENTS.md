# Repository Instructions

## Module boundaries

Keep feature ownership explicit and prevent shared entry points from becoming
cross-domain implementation files.

### Frontend modules

- `src/App.tsx` owns route composition, lazy-loading boundaries, and top-level
  application assembly only. Put queries, mutations, dialogs, and page content
  in their owning `src/features/*` or `src/app/*` module.
- Co-locate feature-specific API adapters, state hooks, and view components.
  Do not route unrelated feature state through `App.tsx` merely to share it.
- Do not keep extending a component with a flat list of cross-domain callback
  props. Group cohesive actions behind feature-owned hooks or action objects.
- Treat Project, Workspace, Session, Git, and Settings as separate feature
  boundaries even when one screen composes several of them.

### UI-test modules

- `tests/ui/ui-harness.mjs` is a compatibility entry point. Harness lifecycle,
  fixture state, and feature route handlers belong in `tests/ui/harness/*`.
- Keep fixture API handlers grouped by feature. A new API domain must not add a
  new branch to one repository-wide request handler.
- Prefer composable fixture builders and scenario overrides over adding every
  state to `tests/ui/fixtures/sidebar-core.mjs`.
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
- `$TREEFOLD_HOME/data/treefold.db` owns Projects, Directories, Workspaces,
  Sessions, Todos, delivery/rebase/reset operations, and similar relational
  runtime records. Do not add user preferences or keymaps to SQLite.
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

- Reuse `src/components/ui` primitives and built-in variants before writing
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

Treefold is delivered as a Tauri desktop App, but deterministic browser-based
coverage is the default verification surface. Use WebdriverIO for regression
coverage and focused browser diagnostics for DOM state, accessibility, geometry,
screenshots, and console errors. Important behavior that depends on the Tauri
runtime, WebView, or native integration may additionally use focused automated
Tauri UI tests. Do not use Computer Use to control the real App or perform a
manual desktop acceptance pass unless the user explicitly requests it. Run the
existing browser suite for user-visible behavior changes and broader frontend
work; presentation-only fixes may use the faster browser-diagnostics workflow
below. Adding or changing automated coverage is not required. New UI tests must
pass the admission gate below.

### Default checks

Run the following from the repository root:

1. Run `npm run typecheck` after every TypeScript or React change, including
   small presentation-only TSX changes. It is the default fast correctness
   check and should not be skipped merely because the edit is visually small.
2. Run `npm run build` for substantial frontend features, routing or lazy-load
   changes, dependency changes, production-bundle changes, or broad layout
   refactors. It is not required for an isolated spacing, color, typography, or
   class-name adjustment when `typecheck` is sufficient.
3. Run `npm run test:ui` for user-visible behavior changes and broader frontend
   work. Presentation-only changes that do not pass the automated UI-test
   admission gate may instead use focused browser diagnostics against a current
   dev UI.
4. For UI presentation defects, prefer a short feedback loop: connect Codex
   browser control to the current dev UI URL emitted by the repository's normal
   development workflow, including `default-app` and similar commands,
   reproduce the affected state, and inspect screenshots, DOM state, computed
   styles, element bounds, hit testing, accessibility, and console errors as
   relevant. Discover and reuse an already-running current instance before
   starting a duplicate UI process.

For important or critical behavior that crosses the browser/Tauri boundary, run
or add a focused Tauri UI test when it provides meaningful regression coverage.
Do not treat manual App acceptance as a default completion requirement. If the
user explicitly requests manual App verification, report the exercised App
states and any remaining gaps. The final handoff must state which commands
passed, which browser diagnostics or Tauri UI tests were used, and any behavior
that remains unverified.

### Deterministic UI fixture

`npm run test:ui` must be self-contained by default. It must not depend on the user's Treefold database, existing Projects, fixed local directories, Git worktrees, or an already-running Tauri backend.

- `tests/ui/ui-harness.mjs` starts the fixture API and Vite on ephemeral ports and closes both in `finally` cleanup.
- `tests/ui/fixtures/sidebar-core.mjs` owns fixed IDs, timestamps, names, and API responses for the sidebar core flow.
- The fixture API must reject and record unimplemented requests so a new frontend dependency cannot silently pass.
- Use inert fixture Sessions; UI layout tests must not launch real Shell or Codex processes.
- Keep fixture data deterministic and include relevant stress states such as long labels, active and archived records, nested tree rows, and empty collections.
- Do not weaken fixture data or assertions merely to make a regression pass. Update them only when the intended product behavior changes.

`TREEFOLD_UI_URL` may be used only when an already-running UI instance is wired to this same deterministic fixture API; it is not a path for testing user data. The default checked-in test path must remain isolated and reproducible.

### WebdriverIO core flow

Keep `tests/ui/sidebar.core.mjs` small and focused on stable, high-value behavior. Do not add a new feature domain to this core flow. Split or replace legacy cross-domain coverage before extending it, and do not treat existing broad coverage as precedent for appending more scenarios.

#### Automated UI-test admission gate

Add or update an automated UI test only when the regression would change at least one of these durable contracts:

- navigation, persisted state, or an API side effect;
- permissions, availability, disabled state, or contextual visibility;
- creation, update, deletion, or lifecycle behavior;
- keyboard behavior or another accessibility semantic;
- shared overlay reachability or occlusion behavior covered under the representative-overlay rules below.

Do not add or update automated tests for presentation-only changes, including spacing, alignment, centering, dimensions, colors, typography, icon placement, animation names, static copy, or visual hierarchy. A useful test must survive a pure CSS refactor that preserves behavior and accessibility. Verify presentation changes with focused browser diagnostics and screenshots. Inspect the current Treefold App only when the user explicitly requests manual App verification.

Outside the representative overlay helper, automated tests must not assert exact pixels, element coordinates, computed CSS properties, DOM sibling order, or animation implementation details. Do not use `getLocation`, `getSize`, `getCSSProperty`, or `compareDocumentPosition` to encode visual design. Functional resize limits may assert the resulting persisted value, but not incidental page offsets.

Do not retain permanent "tombstone" assertions that merely prove a removed label, field, or control is absent. Keep a negative assertion only when absence enforces a current permission, data-ownership, safety, or contextual-visibility contract. Remove transitional assertions once the migration they protect is complete.

Before adding a UI assertion, identify the concrete user-visible failure it detects and confirm that existing coverage does not already detect it. Cover shared components and interaction models once with a representative stress case; usage sites should assert only their distinct business behavior. Prefer unit, API, or contract tests when a browser is not required.

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

The WebdriverIO session and all harness services must always be closed. Save a failure screenshot under `/tmp` when practical.

### Browser diagnostics and optional desktop App acceptance

After WebdriverIO passes, use browser control as an information-rich diagnostic surface where it adds value. Browser inspection is preferred for DOM and accessibility snapshots, computed layout, exact bounds, representative hit testing, screenshots, and console errors.

For presentation-only investigation, browser control may be used directly
against the current dev UI started by the normal development workflow, without
first running the full WebdriverIO suite. The URL is normally emitted by that
workflow and does not need to be supplied explicitly by the user. Treat that
session as focused diagnosis of the reported state, not as deterministic
regression coverage, and state what was inspected in the handoff.

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
menus, scrolling, file drops, and WebView-dependent event behavior—prefer a
focused automated Tauri UI test when practical. Exercise them manually in the
desktop App only when the user explicitly requests it. If a requested App
acceptance pass disagrees with browser or automated Tauri results, report the
disagreement and treat the real App result as authoritative.

If exploration reveals a stable and mechanically testable regression risk, add automated coverage only when it passes the admission gate above. Presentation regressions must not be converted into pixel or CSS assertions.

### Tauri-specific changes

For important logic involving the native title bar, window controls, menus,
filesystem dialogs, terminal integration, or other Tauri APIs, use focused Tauri
UI test coverage when it can exercise the affected contract. Do not run
`npm run dev:desktop`, use Computer Use, or perform manual real-App acceptance
unless the user explicitly requests it.
