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
for repository-specific strategies. One confirmation submits
the whole plan. The backend rechecks every repository before starting, delivers
them sequentially, then archives the Workspace or Fork and stops its Sessions.
New Finish plans keep all worktrees and branches without a checkbox.
Feature-branch delivery pushes without forcing and proves that the remote
feature ref contains the confirmed source commit before cleanup.

Git repositories do not share a transaction. A failure pauses the batch and
preserves successful deliveries. Progress and the confirmed source commits are persisted. Closing the
dialog does not stop execution; after a backend restart, reopen the operation
and continue. Retries skip completed steps and refuse cleanup if the source
branch gained new commits. Finish has no Undo action or automatic rollback;
reverting a delivered change is a separate Git operation on the parent.
Pull request creation and merge remain hosting/user workflows.

An archived Fork can be reopened from its detail page when all
checkouts remain on their recorded branches, its Project and parent Workspace
are active, and neither it nor its parent has unfinished Finish work. Reopening
does not launch Sessions or recreate missing worktrees. It reactivates the linked
Todo and starts a fresh delivery round while retaining parent-operation history.

Delivery uses Finish rather than a separate Integrate into Parent menu action.
Update from Parent retains conflict resolution and Abort, but completed parent
operations have no Undo API. Their recovery refs are released after completion;
the recorded before/result heads remain part of the operation history.

Permanent deletion from a parent list offers **Keep working directories** and
**Keep local branches**, both off by default. Keeping a checkout also keeps its
checked-out branch. Cleanup applies to the Workspace and its archived Forks;
active records must be finished first. Only managed worktrees and generated
branches are eligible. User branches and Project source directories are kept.
All checkouts are checked before cleanup starts; dirty files, changed ownership,
and undelivered commits block destructive cleanup. Keeping branches permits
removing clean worktrees while preserving committed work. Files retained after
record deletion are managed outside Treefold and cannot reopen the deleted item.
Older saved Finish plans retain their previously confirmed cleanup choices.
