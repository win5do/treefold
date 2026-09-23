# Git squash

Treefold supports two separate operations. Neither pushes or force-pushes.

## Finish with Squash merge

The Finish strategy `squash_merge` integrates a Workspace into its local target,
or a Fork into its parent Workspace, as one single-parent commit. The source
branch and its original commits are unchanged. Optional worktree and branch
cleanup still follows the confirmed Finish plan.

Both source and target must be clean, including untracked files, on their
expected branches, and free of other Git operations. Existing merge commits in
the source do not prevent this delivery: its history is not being rewritten.

The existing parent-operation journal records strategy `squash`, fixed source
and target heads, and a recovery ref before running `git merge --squash`.
The target commit contains a `Treefold-Squash: <operation-id>` trailer so restart
reconciliation can recognize it without relying on source ancestry. Commit
hooks and the user's commit signing configuration apply to this delivery commit.

A conflict pauses Finish and preserves all worktrees. Resolve and stage the
conflicts, then commit using the command shown in the operation panel (including
its trailer), or use the existing Codex resolver. Abort restores the original
target only if it has not acquired another commit. Retry recognizes a completed
operation rather than delivering it twice. Cleanup checks the recorded source
HEAD and verifies the squash result is still reachable in the target; it does
not require the source commits to be target ancestors.

The commit message is generated from the source branch. Editing the delivery
message is not part of this version. If the source is already an ancestor of the
target, delivery is a no-op. Finish ends this Workspace/Fork; this is not a
repeated incremental squash-delivery workflow.

## Git History selection squash

Select a commit, Shift-click another commit, then choose `Squash Commits…` in
the context menu. The backend validates the actual commit graph, not row indexes.

A selection must contain at least two consecutive commits on the current
branch's first-parent chain. It may end at HEAD or in the middle:

```text
base--A--B--C--D--E  HEAD
         [B C]
base--A----S--D'--E' HEAD
```

The selected range and every later commit up to HEAD must be linear. A merge
inside the selection or after it blocks squash. An earlier merge remains intact.
There is no flatten-merge mode.

For Workspace/Fork repositories, the fixed `start_commit` is the preserved base.
For Project repositories without managed ownership, the first-parent root is
the preserved base. The base itself cannot be selected. The preview shows it.

### Safety checks

Preview and apply run under the Git-common-directory mutation lock. Apply
revalidates the request before publishing the replacement history:

- attached local branch and exact expected HEAD;
- clean index/worktree, including untracked files, and no Git operation;
- complete, non-shallow history without replacement refs;
- full hashes, correct oldest-to-newest order, continuity, and base boundary;
- no merge anywhere in the rewritten interval;
- no rewritten commit referenced by a known remote-tracking ref or tag;
- no active parent operation, started Finish batch, completed integration, or
  selected history already reachable in the managed target;
- active writable managed ownership when applicable.

Other local branches keep their old history; the dialog warns about them.
Remote publication checks use local remote-tracking refs, without fetching.
External squash merges/cherry-picks cannot be reliably inferred from ancestry;
Treefold uses its own delivery journal for managed operations.

### Execution, metadata, and recovery

Treefold constructs immutable commit objects before changing any branch. `S`
uses the newest selected commit's exact tree. Each later commit is recreated
with its exact original tree, author, author date, and message, including empty
commits. This preserves every intermediate file snapshot without running a
rebase in the user's worktree. The final tip must have the original HEAD tree.

The combined commit uses the current Git identity. Rewritten commits receive
new hashes and committer metadata, are unsigned, and do not run commit hooks.
The dialog discloses this. Non-UTF-8 replay messages are rejected.

A single `git update-ref --stdin` transaction publishes the replacement branch
with compare-and-swap and creates branch-bound `before`/`after` recovery refs
under `refs/treefold/squash/`. The index and worktree are never reset or rewritten.
An interrupted preparation leaves the original branch unchanged; recovery refs
and the branch update are committed together.

The current History panel offers Undo. Undo requires clean state, the exact
squash result at HEAD, matching branch-bound recovery refs, and no subsequent
publication or managed delivery. It atomically restores the old branch and
removes that recovery pair. Recovery refs otherwise remain available across
restart; automatic retention cleanup and recovery browsing are deferred.

The API is `POST /api/{project|workspace}-repositories/{id}/git/squash`:
`action=preview|apply` takes `commits` and `expected_head`; apply also requires
`message`. `action=undo` takes `recovery_id` and `expected_head`.
