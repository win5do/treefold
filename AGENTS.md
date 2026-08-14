# Repository Instructions

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

## UI verification workflow

Every user-visible frontend change must be verified with a small WebdriverIO core flow and a focused Codex UI exploration pass. These checks complement each other and neither may replace the other.

### Required checks

Run the following from the repository root:

1. `npm run typecheck` after changing TypeScript or React code.
2. `npm run build` for layout, routing, dependency, or production-bundle changes.
3. `npm run test:ui` for every user-visible UI change.
4. After the automated checks pass, inspect the affected states in the live UI with Codex browser control and check the browser console for errors.

Do not report a UI change complete while a required check is failing. The final handoff must state which commands passed, which UI states were explored, and any native behavior that remains unverified.

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

Keep `tests/ui/sidebar.core.mjs` small and focused on stable, high-value behavior. Extend the existing core flow when a change affects it instead of building a broad screenshot suite.

Purely presentational style changes do not require adding or updating automated tests when they leave behavior, semantics, visibility, and interaction unchanged. Verify those changes with the existing UI flow and focused live visual inspection instead.

Prefer semantic locators such as roles, accessible names, and labels, followed by stable `data-testid` attributes. Do not locate controls by fragile DOM depth or absolute screen coordinates. When geometry is the requirement, assert element bounds with a small explicit tolerance.

Core assertions should cover the applicable behavior:

- controls appear only in the correct Project, Workspace, or Session context;
- sidebar show, hide, resize, minimum size, tree nesting, and content offsets;
- long labels do not hide or misalign row actions;
- toolbar titles align with page content;
- contextual panels and primary navigation open and close correctly;
- archived records stay out of active navigation while retained history remains available where intended.

### Floating overlay verification

Menus, popovers, tooltips, combobox lists, and other floating overlays require interaction and visual-occlusion coverage; DOM presence or `isDisplayed()` alone is insufficient.

- Exercise complete pointer and keyboard trajectories, including moving between sibling triggers, moving from a trigger into its child overlay, moving from an overlay item to a non-overlay action, leaving the whole overlay, outside click, and Escape. Assert both what appears and what must disappear after every transition.
- Render overlays that must escape scroll containers or stacking contexts through a document-level portal. Do not rely on a larger `z-index` to escape an ancestor's `overflow`, transform, containment, or stacking context.
- At representative minimum/maximum container sizes and viewport-edge positions, assert overlay bounds remain inside the viewport. Include nested and near-bottom triggers when the UI supports them.
- Verify actual paint-order reachability with `document.elementFromPoint()` at the center and inset corners of each overlay surface. The expected overlay must own every sampled hit; this catches clipping and occlusion that visibility APIs miss.
- Capture and inspect screenshots whenever the risk involves clipping, overlap, alignment, stacking, animation, or hierarchy. A DOM snapshot may complement but cannot replace the screenshot for these risks.
- Prefer small reusable geometry/hit-test helpers and stable overlay test IDs so the same acceptance checks apply to future floating UI instead of one specific menu.

The WebdriverIO session and all harness services must always be closed. Save a failure screenshot under `/tmp` when practical.

### Codex UI exploration

After WebdriverIO passes, use the running app to inspect the change as a user would:

- exercise each changed state, including applicable expanded, collapsed, empty, long-label, and contextual states;
- inspect screenshots when spacing, clipping, overlap, hierarchy, or alignment matters;
- compare element bounds when exact visual alignment is part of acceptance criteria;
- verify persistent controls remain reachable after panels are hidden;
- confirm contextual controls do not leak into unrelated routes;
- inspect browser console errors before finishing.

If exploration reveals a stable and mechanically testable regression risk, add the smallest corresponding WebdriverIO assertion and rerun the core flow.

### Tauri-specific changes

Browser verification is sufficient for ordinary React layout and interaction changes. Changes involving the native title bar, window controls, menus, filesystem dialogs, terminal integration, or other Tauri APIs also require a focused `npm run dev:desktop` check of the affected native flow. Use an isolated `TREEFOLD_HOME` when a native test could mutate persistent application data.
