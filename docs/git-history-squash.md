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

The Finish dialog shows an editable message for each Repository when Squash is
selected, defaulting to `Squash <source-branch>`. Review all Repository messages
in the same scrollable dialog and submit them together. Editing these drafts
does not execute Git. The confirmed messages are saved with the batch and parent
operation, including across restart and conflict resolution. Treefold appends
its internal trailer; user messages cannot supply that reserved marker. If the source is already an ancestor of the
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

## Edit the latest commit message

Git History offers `Edit Commit Message…` for the current branch HEAD, including
root and merge commits. The editor loads the full message. Saving creates a new
commit from the existing tree and parents, retains the original author, and
updates the branch with an expected-old-hash check and reflog entry. The index
and working files are untouched. Commit signing configuration applies; commit
hooks are not run for this message-only rewrite.

Publication checks use local remote-tracking refs only: this action never fetches.
Remote refs, tags, or other local branches containing the commit trigger a warning
that users may cancel or confirm. Only the current branch moves; the other refs
remain unchanged. New references appearing before save require confirmation too.
A later push may require force push. Local checks cannot establish that a commit
has never been published.

Editing earlier commits is not supported. Active Git/Treefold operations and
commits referenced by Treefold delivery records are blocked to preserve recovery
and cleanup semantics. Squash delivery messages can instead be edited before
confirming delivery. HEAD and branch are checked again before publishing the
replacement, so stale editors cannot overwrite newer commits.
