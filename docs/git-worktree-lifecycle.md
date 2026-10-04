# Git Worktree Lifecycle

```text
Create → Work ↔ Intermediate delivery → Finish → Archive → Delete / Cleanup
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
its parent during Finish, the assigned Todo becomes done. Intermediate delivery
does not complete the Todo.

Fork delivery first selects **Finish and archive** or **Intermediate delivery**.
Finish then offers **Merge into parent** or **Abandon delivery**. Only Finish with
merge offers **Squash into one commit**, unchecked by default. Abandoning delivery
archives retained work without merging or deleting it. The strategy applies to
every writable repository; repository tabs display preflight and execution results.
Intermediate delivery only supports ordinary merge, leaves the Fork and repositories
active, and neither stops Sessions nor completes Todos. It persists recoverable
batch progress and allows a fresh delivery after completion. It cannot skip damaged
repositories or delete checkouts. Squash's inline explanation describes the different
parent and Fork histories and recommends a new Fork for subsequent work.

Workspace delivery uses the same operation-wide choices and vertical radio options.
It supports ordinary merge into the Project checkout's current branch, feature-branch
push, or (when finishing) abandoning delivery. Squash is available only for Finish
with merge. Every writable repository uses the same strategy; missing push targets
block the entire plan rather than selecting another strategy per repository.
Project and Workspace repositories no longer store a default delivery mode.
One confirmation submits the whole plan. The backend rechecks every repository before starting, delivers
them sequentially. Finish then archives the Workspace or Fork and stops its Sessions.
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

An archived Workspace or Fork can be reopened from its detail page when all
checkouts remain on their recorded branches, its Project (and parent Workspace for a Fork)
is active, and neither it nor its parent has unfinished Finish work. Reopening
does not launch Sessions or recreate missing worktrees. It reactivates the linked
Todo and starts a fresh delivery round while retaining parent-operation history.
A previous completed Squash delivery requires explicit confirmation to reopen:
the dialog recommends **New Fork from parent** or **New Workspace from Project**,
with **Reopen anyway** and **Cancel**.
Reopening never rebases or resets the branch. The new-item action opens the standard
creation dialog using the parent Workspace or Project; the archived item remains unchanged.

Delivery uses one Fork delivery dialog rather than a separate Integrate into Parent menu action.
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

New Workspace repositories inherit the remote from the corresponding Project
checkout's current branch, never the Project's stored preferred remote. The remote
branch defaults to the new local branch name. Creation can override each remote
without modifying Project settings; a checkout without an upstream remote starts
unconfigured. Local development is still available, and push requires configuring
the Repository target first. A successful push establishes the Git upstream.

## Deferred pull request creation

Repository-configured pull request creation is deferred. If added, Treefold may
run a user-provided command such as `gh pr create` after pushing a Workspace
feature branch. Treefold supplies delivery context; the configured CLI and the
user's environment own provider selection, credentials, and authentication.
Treefold must not add Git hosting token or authentication management for this
workflow. Pull request review and merge remain on the Git hosting platform.
