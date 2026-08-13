# Product Strategy

Treefold is a local-first worktree and agent-session manager. Its value is a
small, explicit hierarchy: `Project → Workspace → Session`.

- **Project is repository context.** It stores Git metadata, directories,
  remotes, a default target branch, and a default delivery policy.
- **Workspace is development context.** It owns an isolated worktree, feature
  branch, fixed target, optional upstream, Sessions, and Todos.
- **Session is execution context.** It runs Shell or Codex inside a Workspace.
- **Parallel work is flat.** Independent features are sibling Workspaces; no
  nested development object is required.
- **Delivery follows real repositories.** Teams can use remote review and CI;
  individuals can merge locally and optionally push the target branch.
- **Escape hatches are honest.** Project tools are unmanaged and the user owns
  their effects; Treefold still validates Git state before managed operations.

The product should make `Create → Work → Sync → Verify → Finish → Cleanup`
reliable without attempting to replace Git hosting, code review, CI, or Codex's
own conversation history.
