# Git Worktree Lifecycle

```text
Create → Work → Sync → Rebase/Recover → Finish → Cleanup
```

| Phase | Safety boundary |
| --- | --- |
| Create | Resolve a fixed target, create a unique branch and managed worktree |
| Work | Sessions and Todos belong to the Workspace |
| Sync | Pull fast-forwards the feature branch; Push never forces |
| Rebase | Rebase explicitly onto the fixed target with Continue/Abort recovery |
| Finish | Preflight then verify remote merge, merge locally, preserve, or discard |
| Cleanup | Remove worktree/branch only after the selected outcome is proven |

Project Pull/Push synchronizes the configured target branch in the source
checkout. Workspace Pull/Push synchronizes the configured feature upstream.
These are separate buttons because they mutate different branches and have
different safety preconditions.

The finish operation advances through durable phases. A failed push after a
local merge leaves the delivery resumable and does not pretend cleanup
succeeded. Remote-review delivery fetches the remote target and proves that the
Workspace head is reachable before removing local Git resources.
