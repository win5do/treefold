# Developing amux with Treefold

Treefold's amux dependency is a full GitHub commit declared by `rev` in
`src/backend/Cargo.toml` and pinned in `src/backend/Cargo.lock`; ordinary builds
do not update it.
The runtime library, bundled CLI, and `skills/amux` must all come from that same
checkout. Keep the `amux-runtime` package name, `amux` library/binary targets,
and `skills/amux/SKILL.md` available together when changing this integration.

To use an amux worktree, run from the intended Treefold checkout:

```sh
export TREEFOLD_AMUX_MANIFEST=/absolute/path/to/amux-worktree/Cargo.toml
just check-backend
just prepare-sidecars
just app-dev-watch
```

An absolute path allows the two worktrees to live anywhere. A relative value
is resolved from the Treefold checkout. Source changes need not be committed.
Each Treefold development process can select a different amux worktree through
its own environment; no shared symlink or global Cargo configuration is needed.

Treefold's xtask applies a local Cargo patch, uses temporary backend and CLI lockfiles,
and verifies Cargo actually selected that manifest before building. It also
builds the CLI and copies the Skill from the resolved package directory. The
selected source is printed during builds and recorded in staged
`amux-source.json`. Watch mode rebuilds when the selected amux Rust sources or
Cargo files change and refreshes the Skill with each build. For Skill-only edits,
run `just prepare-sidecars`.
Local package versions can differ from the pinned Git version; neither
repository's committed lockfile is rewritten by the override.
When the selected source changes, xtask invalidates the amux CLI artifact before
building it. This prevents Cargo from reusing a CLI from another Git checkout
that has the same package version; other dependency caches are retained.

For a focused backend command, use `cargo xtask backend test <test-filter>`
(also supports `build`, `check`, `clippy`, and `run`). Raw backend Cargo commands
do not apply `TREEFOLD_AMUX_MANIFEST`; Treefold rejects them when it is set.
The override does not alter ordinary Cargo commands in the amux repository.

Unset `TREEFOLD_AMUX_MANIFEST` and rebuild to return to the locked Git source.
To advance that default dependency, first push the amux commit and set Treefold's
`src/backend/Cargo.toml` dependency `rev` to its full hash, then run in Treefold:

```sh
cargo update --manifest-path src/backend/Cargo.toml -p amux-runtime
```

Commit the manifest and resulting lockfile change after verifying the new revision.

## Runtime recovery

The Resources popover distinguishes an unavailable runtime from a stopped one.
When amux is unavailable, Treefold preserves Session states and offers connection
retry. Explicit runtime recovery requires confirmation because it terminates the
old runtime's terminals, agents, and services before starting a new instance.
The backend delegates recovery to amux; it does not maintain a separate PID-kill
implementation. If ownership cannot be verified, recovery stays disabled and the
old runtime must be stopped manually. A healthy daemon at an old registered
socket can be stopped normally through this recovery flow.
