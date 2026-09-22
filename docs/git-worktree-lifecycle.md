# Git Worktree Lifecycle

```text
Create → Work → Sync → Rebase/Recover → Finish → Cleanup
```

| Phase | Safety boundary |
| --- | --- |
| Create | Resolve a fixed target, create a unique branch and managed worktree |
| Work | Managed Sessions and development Todos belong to Workspace/Fork |
| Sync | Pull fast-forwards the feature branch; Push never forces |
| Rebase | Rebase explicitly onto the fixed target with Continue/Abort recovery |
| Finish | Preflight then merge locally, push the feature branch, or preserve |
| Cleanup | Remove worktree/branch only after the selected outcome is proven |

Project Pull/Push synchronizes the configured target branch in the source
checkout. Workspace Pull/Push synchronizes the configured feature upstream.
These are separate buttons because they mutate different branches and have
different safety preconditions.

Forks have neither Pull nor Push. They follow their parent Workspace locally and
finish by merging into that parent's checkout. A root Workspace cannot finish
while it still has active Forks. When every repository in a Fork is merged into
its parent, the assigned Todo becomes done.

Finish configures all unfinished repositories in one dialog, with vertical tabs
for repository-specific strategies and cleanup options. One confirmation submits
the whole plan. The backend rechecks every repository before starting, delivers
them sequentially, then performs cleanup and archives the Workspace or Fork.
Feature-branch delivery pushes without forcing and proves that the remote
feature ref contains the confirmed source commit before cleanup.

Git repositories do not share a transaction. A failure pauses the batch and
preserves successful deliveries; cleanup begins only after all deliveries
succeed. Progress and the confirmed source commits are persisted. Closing the
dialog does not stop execution; after a backend restart, reopen the operation
and continue. Retries skip completed steps and refuse cleanup if the source
branch gained new commits. Finish has no Undo action or automatic rollback;
reverting a delivered change is a separate Git operation on the parent.
Pull request creation and merge remain hosting/user workflows.
