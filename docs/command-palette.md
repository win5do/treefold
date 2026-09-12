# Command palette

Open with Cmd+Shift+P. Search action names or IDs, select with arrows and Enter,
or click an action. Escape dismisses the palette and restores the invoking focus.
Settings → Keymap can override or disable `app.palette.open`.

`features/actions/model.ts` defines actions with `id`, `name`, `scope`,
`available(context)`, and `run(context)`. IDs have three dot-separated segments.
Scopes describe feature ownership: global, project, workspace, fork, or session.
Availability is separate: creating a Session needs an active owner, but does not
need an existing Session. Only available actions appear in the palette.

Session actions live in `features/terminal/sessionActions.ts`. Both direct
shortcuts and palette selection execute these definitions. Existing user keymap
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

Opening the palette captures the current route, Project, Workspace (including
Fork identity through `parent_workspace_id`), Session, Session directory, and
invoking element before focus moves. It retains the action handlers from that
invocation. Selection and the subsequent New Session dialog use this captured
context even when the route changes. Context comes from the active page; merely
hovering an unrelated sidebar row does not retarget it. Backend lifecycle checks
remain authoritative if the captured entity changes or disappears while open.
