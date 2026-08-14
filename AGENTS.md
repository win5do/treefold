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

Treefold is delivered as a Tauri desktop App, so the current desktop build is the final acceptance surface for every user-visible frontend change. Browser-based tools remain required for deterministic regression coverage and are useful for inspecting DOM, accessibility state, geometry, and console errors, but browser behavior or screenshots must not be treated as proof that the App behaves or renders the same way. Every user-visible frontend change must run the existing WebdriverIO core flow, complete focused browser diagnostics where useful, and finish with a focused Treefold App acceptance pass. Running the existing suite is required; adding or changing automated coverage is not. New UI tests must pass the admission gate below.

### Required checks

Run the following from the repository root:

1. `npm run typecheck` after changing TypeScript or React code.
2. `npm run build` for layout, routing, dependency, or production-bundle changes.
3. `npm run test:ui` for every user-visible UI change.
4. After the automated checks pass, use Codex browser control when it helps inspect DOM state, accessibility, element bounds, hit testing, or browser console errors.
5. Perform final visual and interaction acceptance in the current Treefold desktop App. Use Computer Use to operate the App as a user would and inspect App screenshots for the affected states.

Do not report a UI change complete while a required check is failing or while the desktop App acceptance pass is blocked. Do not substitute browser verification when the App cannot be launched, is stale, or cannot expose the affected flow; report the work as incomplete and state the blocker instead. The final handoff must state which commands passed, which browser diagnostics were used, which App states and interactions were exercised, and any behavior that remains unverified.

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

Do not add or update automated tests for presentation-only changes, including spacing, alignment, centering, dimensions, colors, typography, icon placement, animation names, static copy, or visual hierarchy. A useful test must survive a pure CSS refactor that preserves behavior and accessibility. Verify presentation changes by running the existing suite and inspecting the current Treefold App instead.

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

### Browser diagnostics and desktop App acceptance

After WebdriverIO passes, use browser control as an information-rich diagnostic surface where it adds value. Browser inspection is preferred for DOM and accessibility snapshots, computed layout, exact bounds, representative hit testing, and console errors. It may explain a defect and support automated coverage, but it is not the final visual or interaction authority.

Then launch or connect to a Treefold desktop App built from the current working revision and inspect the change as a user would. Use an isolated `TREEFOLD_HOME` whenever the acceptance flow could mutate persistent application data. Avoid validating against a stale packaged App or an unrelated already-running dev process. In the App:

- exercise each changed state, including applicable expanded, collapsed, empty, long-label, and contextual states;
- inspect App screenshots when spacing, clipping, overlap, hierarchy, typography, color, or alignment matters;
- perform the real pointer, keyboard, focus, scrolling, menu, and window interactions affected by the change;
- verify persistent controls remain reachable after panels are hidden;
- confirm contextual controls do not leak into unrelated routes;
- watch the desktop dev-process output for runtime errors when available.

Platform-sensitive interactions—including drag and drop, pointer capture, focus transfer, keyboard shortcuts, IME, clipboard behavior, context menus, scrolling, file drops, and WebView-dependent event behavior—must be exercised in the desktop App even when the same flow passes in Chrome. If App acceptance disagrees with Browser, the App result is authoritative.

If exploration reveals a stable and mechanically testable regression risk, add automated coverage only when it passes the admission gate above. Presentation regressions remain part of focused App visual inspection and must not be converted into pixel or CSS assertions.

### Tauri-specific changes

Changes involving the native title bar, window controls, menus, filesystem dialogs, terminal integration, or other Tauri APIs require a focused `npm run dev:desktop` check of the affected native flow in addition to the general App acceptance pass. Browser-only validation is never sufficient for these changes.
