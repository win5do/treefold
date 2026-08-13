# Product Strategy

Treefold is a local-first worktree and agent-session manager. Its value is a
small, explicit hierarchy: `Project → Workspace → Fork`, with managed Sessions
owned by development units.

- **Project is repository context.** It stores Git metadata, directories,
  remotes, a default target branch, and a default delivery policy. Unmanaged
  external tools support repository-level operations in the source checkout.
- **Workspace is development context.** It owns an isolated worktree, feature
  branch, fixed target, optional upstream, Sessions, and Todos.
- **Fork is bounded parallel context.** It is one level of local subwork beneath
  a Workspace, with no remote synchronization and no nested Forks.
- **Session is execution context.** It runs Shell or Codex inside a Workspace or
  Fork checkout.
- **Delivery follows real repositories.** Teams can use remote review and CI;
  individuals can merge locally and optionally push the target branch.
- **Escape hatches are honest.** Project Open Shell/Open Codex processes are not
  managed Sessions, and the user owns their effects in the source checkout.

The product should make `Create → Work → Sync → Verify → Finish → Cleanup`
reliable without attempting to replace Git hosting, code review, CI, or Codex's
own conversation history.
