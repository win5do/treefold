# Deferred Git History squash design

Git History squash is a possible future feature. Treefold does not expose a
squash API or UI yet, and this document is not a supported runtime contract.
It records the intended safety boundary so a later implementation does not
reduce squash to list-index manipulation or an unsafe interactive rebase.

## Intended behavior

Git History may offer `Squash N commits...` for a contiguous range on the
current branch's first-parent path. The range may be at `HEAD` or in the middle
of the branch.

For a middle range:

```text
A---B---C---D---E  current branch
    [ B + C ]

A---S---D'--E'
```

`S` combines `B` and `C`. Commits after the selection are replayed, so `D'`
and `E'` have new commit identities. When the operation completes without a
conflict:

```text
tree(S)  == tree(C)
tree(D') == tree(D)
tree(E') == tree(E)
```

The replayed commits retain the same changes and resulting file contents, but
their parent, committer metadata, signatures, and hashes may change. Empty
commits require an explicit preserve-or-reject policy rather than being
silently dropped.

## History order is not selection topology

Git History uses `git log --topo-order` for a readable traversal. Topological
order keeps parents after their children and avoids unnecessarily interleaving
parallel development lines, but it does not define a unique order between
unrelated commits. Adjacent rows are therefore not evidence that two commits
are parent and child.

A future history DTO must include each commit's parent hashes. The backend must
derive and validate the selected first-parent interval from the commit graph;
it must not trust frontend indexes, visual adjacency, or a client-provided
commit count.

Commits that appear only on a merge's second-parent line are not part of the
current branch's selectable first-parent interval. They should be edited from
the worktree that owns that branch. Selecting a merge commit on the current
first-parent line may, however, flatten the merge as described below.

## Merge commits

A merge commit is safe to process when it is completely contained in the
selected interval and the user accepts flattening its topology:

```text
A---B---------M---C---D---E
     \---X---/
    [ B + M + C ]

A---S---D'--E'
```

`S` uses the tree of `C`, so the already-resolved merge result is preserved
without rerunning the merge or resolving its old conflicts again. The new
commit is an ordinary single-parent commit. The merge's second-parent ancestry,
merge message, signatures, and topology are not retained. A later merge of the
old side branch may attempt to introduce the old changes again.

The confirmation UI must call this operation a flattened merge and explain the
lost ancestry. A future preserve-merges mode is a separate feature and is not
part of this design.

A merge commit is not safe when it occurs after the selected interval:

```text
A---B---C---M---D---E
    [ B + C ]
```

Here `M` would need to be recreated while replaying the suffix. The operation
must be blocked rather than silently flattening, dropping, or guessing how to
rebuild that merge. In summary:

- merge before the selected interval: allowed and unchanged;
- merge inside the selected interval: allowed with explicit flattening consent;
- merge after the selected interval and at or before `HEAD`: blocked.

Multiple or octopus merges inside the selected interval may be flattened only
if the same endpoint-tree guarantee and all other preflight rules hold. The UI
must report how many merge commits and second-parent lines lose ancestry.

## Published and shared history

Finding a rewritten commit on another ordinary local branch is not by itself a
blocker. That branch remains unchanged and continues to reference the original
commits. Treefold should warn that the histories will diverge and that a later
merge may see equivalent changes under different commit identities.

If the current branch has already been pushed, squash may proceed after an
explicit warning. Updating that remote branch will require a separate force
push. Treefold must never perform that push implicitly and, if force push is
later supported, must use `--force-with-lease`, never an unconditional
`--force`.

Tags that reference any rewritten commit are blockers by default because they
usually represent an intentional release or audit boundary.

## Treefold target ownership

Squash in a Workspace or Fork must not rewrite commits that have already been
integrated into its Treefold parent or target worktree. Rewriting only the
source would create a second history while leaving the target on the delivered
history. The UI should block the source operation and direct the user to the
target worktree, where the target branch owns any subsequent rewrite.

Integration detection should combine current Git reachability with Treefold's
delivery records. Reachability alone cannot recognize an earlier squash merge
or cherry-pick whose commit hashes differ from the source.

Moving to the target worktree does not bypass the merge policy. A fast-forwarded
linear target may be eligible, while a target range that would require replaying
a merge commit remains blocked.

## Preflight rules

The backend must rerun every check while holding the repository's Git-common-dir
mutation lock. An eligible operation requires:

- an attached, writable local branch;
- at least two selected first-parent commits;
- an exact contiguous selected interval;
- no merge commit in the replay interval after the selection;
- a clean index and worktree with no unresolved paths;
- no merge, rebase, cherry-pick, revert, delivery, or other Git operation in
  progress;
- an `expected_head` equal to the current `HEAD`;
- no rewrite across the Workspace/Fork start or ownership boundary;
- no selected or replayed commit already integrated into the Treefold target;
- no blocking tag or repository policy.

Remote publication, ordinary local branch references, and flattened merges
inside the selection are warnings that require explicit consent rather than
automatic blockers.

An illustrative preflight result is:

```json
{
  "allowed": true,
  "selected_commit_count": 3,
  "replayed_commit_count": 2,
  "flattened_merge_count": 1,
  "requires_force_push": true,
  "affected_refs": ["refs/remotes/origin/feature-x"],
  "blockers": [],
  "warnings": [
    "The selection contains a merge whose ancestry will be flattened",
    "The branch has been pushed and a later update requires force-with-lease"
  ]
}
```

## Execution and recovery

The preferred implementation prepares the replacement history away from the
active branch so failure does not leave the user's worktree midway through a
rebase:

1. acquire the Git-common-dir mutation lock and rerun preflight;
2. record the original `HEAD` and create a Treefold recovery ref;
3. create `S` from the newest selected commit's tree, using the oldest selected
   commit's first parent as `S`'s parent;
4. replay the linear commits after the selection in a temporary ref/worktree,
   preserving intentionally empty commits according to policy;
5. abort and remove temporary state on any conflict, leaving the active branch
   unchanged;
6. verify that the prepared tip's tree equals the original `HEAD` tree;
7. atomically update the current branch only if it still equals `expected_head`;
8. refresh History and Changes and offer Undo while the new tip is unchanged.

If the oldest selected commit is a root commit, `S` has no parent. Workspace
ownership boundaries will normally make that case ineligible; a Project-level
implementation must handle it explicitly rather than assuming `<oldest>^`
exists.

Undo may restore the recovery ref only when the current branch still points to
the squash result. It must not overwrite later user or Agent commits.

## API and UI shape

The mutation request should identify commits and concurrency state explicitly:

```json
{
  "commits": ["<oldest>", "<middle>", "<newest>"],
  "expected_head": "<original-head>",
  "message": "Combined commit message",
  "flatten_merges": true
}
```

The server derives the effective interval, replay suffix, parent relationships,
and counts. It must reject omitted commits, reordered hashes, stale history, and
an unnecessary or missing `flatten_merges` acknowledgement.

The confirmation dialog should show, before mutation:

- how many commits become `S`;
- how many later commits receive new identities;
- whether merge topology will be flattened;
- whether a later push needs `--force-with-lease`;
- which local, remote, tag, Workspace, or Fork refs are affected;
- the editable message for `S`.

After success, the API should return at least the old head, new head, new squash
commit, rewritten-commit mapping, refreshed history, and Undo eligibility.

## Verification expectations

A future implementation should cover these durable cases:

- squash a range ending at `HEAD`;
- squash a middle range and prove each replayed tree matches its predecessor;
- allow and clearly acknowledge a merge fully inside the selected interval;
- allow an earlier merge outside the rewrite interval;
- block a merge in the replay suffix;
- warn for pushed history and ordinary shared branch refs;
- block integration into a Treefold parent/target and direct the user there;
- block stale `HEAD`, dirty state, tags, and Workspace/Fork boundary crossing;
- preserve or explicitly reject empty commits;
- leave the active branch unchanged after a replay conflict or process failure;
- restore the old history only when Undo's expected new head still matches.

## Deferred implementation

Implementation should begin only after Git History exposes parent topology and
the product has agreed on flattened-merge copy, commit signing and hook
behavior, empty-commit handling, recovery-ref retention, and the force-push UI.
Until then, Treefold should expose no partial squash action.
