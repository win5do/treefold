# Project Session Implementation

Project pages can create formal Shell and Codex Sessions in the source
checkout. The public model is a Session directly owned by the Project.

The persistence layer lazily creates one hidden `base` Workspace per Project.
It uses `checkout_mode = in_place`, points at the primary source checkout, and
exists only to reuse the same Session, PTY, restart, resume, and archive
machinery as Workspace and Fork Sessions. It is excluded from visible Workspace
lists, reconciliation, delivery, Pull/Push, and Fork creation.

Commands executed by a Project Session are intentionally unrestricted within
the user's environment. Treefold does not pretend they are isolated feature
development, and later managed Git operations still validate real checkout
state before mutating it.
