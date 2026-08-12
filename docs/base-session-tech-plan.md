# Project Base Sessions

## Goal

Expose the user's registered project directories as an explicit Base workspace without weakening Workstream isolation. Base sessions support repository maintenance such as configuring remotes, fetching, pushing, and inspecting the checkout. Workstream creation and settlement continue to snapshot and validate Git state independently.

## Interaction model

- The `+` action on a Project creates a Shell or Codex session in the primary directory.
- Right-clicking a Project, Workstream, or Fork opens `New Session in…`, followed by a directory and then the Shell/Codex type.
- Native context menus remain available outside those navigation rows.
- Base sessions appear directly beneath their Project and use Project-scoped routes.

## Backend model

Base sessions reuse the established terminal lifecycle through one internal, hidden `kind=base` workspace per Project. This keeps process restart, Codex resume, visibility, and cleanup semantics in one implementation while the API and UI expose Project ownership. The base workspace points at the primary source directory; selecting another directory changes the session cwd.

The hidden workspace is excluded from Project Workstream lists and is created lazily by `POST /api/projects/{id}/sessions`. Session creation validates that the selected directory belongs to the Project.

## Safety and settlement

Base sessions are deliberately unrestricted. Treefold must not infer repository safety from whether a terminal is open. Workstream base commits remain fixed at creation, and settlement/rebase preflight continues to use actual HEAD, branch, dirty-state, and in-progress Git-operation checks.

## Acceptance

- Project `+` defaults to the primary directory.
- Project and Workstream right-click menus expose every attached directory and both session types.
- Codex receives the selected directory, matching Shell behavior.
- Base sessions can be opened, restarted, hidden, and revisited through Project routes.
- Existing Workstream and Fork session behavior remains unchanged.
