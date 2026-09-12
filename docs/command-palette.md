# Command palette

Open with Cmd+Shift+P. Search action names or IDs, select with arrows and Enter,
or click an action. Escape dismisses the palette and restores the invoking focus.
Settings → Keymap can override or disable `app.palette.open`.

`features/actions/model/` is the public action contract. Consumers import from
`@/features/actions/model`. `app.ts` and `session.ts` are the single TypeScript
source for IDs, names, scopes, default shortcuts, and keyboard/palette policies.
`registry.ts` derives ID unions, validates IDs and binding uniqueness, and exposes
lookup and keymap metadata. `types.ts` defines invocation context and behavior;
`bindings.ts` joins declarations with a complete, typed handler map.
IDs have three dot-separated segments.
Scopes describe feature ownership: global, project, workspace, fork, or session.
Availability is separate: creating a Session needs an active owner, but does not
need an existing Session. Only available actions appear in the palette.

Session behavior lives in `features/terminal/sessionActions.ts`; global behavior
lives in `features/app/actions.ts`. These provide `available(context)` and
`run(context)` without duplicating names, scopes, or default shortcuts. Both direct
shortcuts and palette selection execute the same bound actions. Existing user keymap
keys remain stable through `keymapId` mappings:

| Action ID | Existing keymap key |
| --- | --- |
| session.create.new | session.new |
| session.lifecycle.close | session.close |
| session.navigate.next | session.next |
| session.navigate.previous | session.previous |

Global palette actions currently include `app.settings.open`, `app.projects.open`,
`app.leftSidebar.toggle`, and `app.rightSidebar.toggle`; these do not have assigned
shortcuts. Left and right sidebars toggle independently. The right sidebar action
is available only in a Project, Workspace, or Session context, matching the
inspector's toolbar control.

`app.palette.open` is registered like every other action. Its `allowInInput`
policy permits the shortcut in editable inputs. `showInPalette: false` avoids
offering an action to open the palette inside the palette itself. Existing overlay
protection still applies to all shortcuts.

## Rust keymap generation

Run `just actions-generate` (or `npm run actions:generate`) after changing keymap
declarations, and commit `src/backend/src/keymap/action_definitions.rs` with the
TypeScript change. Only config key, display name, and default shortcut are emitted.
Rust owns config persistence, validation, and conflict detection; context, scope,
and execution remain frontend concerns. No JSON or runtime Node dependency is used
by Rust. The generated file is an ordinary Rust module.

`just actions-check` verifies the generated file without writing; `just check`
includes it. UI fixtures use the same TS keymap declaration. The HTTP shape,
command order, and existing keymap configuration keys remain unchanged.

Opening the palette captures the current route, Project, Workspace (including
Fork identity through `parent_workspace_id`), Session, Session directory, and
invoking element before focus moves. It retains the action handlers from that
invocation. Selection and the subsequent New Session dialog use this captured
context even when the route changes. Context comes from the active page; merely
hovering an unrelated sidebar row does not retarget it. Backend lifecycle checks
remain authoritative if the captured entity changes or disappears while open.
