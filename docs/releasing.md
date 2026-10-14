# Releasing Treefold

## CI workflows

| Workflow | Trigger | Scope |
| --- | --- | --- |
| **Check** (`check.yml`) | Pull requests targeting `main`, pushes to `main`, or manual dispatch | `just check`: action metadata, TypeScript types, SQLx metadata, Rust formatting, and `cargo check`. No Electron/sidecar builds, packaging, or test suites. |
| **Test** (`test.yml`) | Manual dispatch only | Rust, backend lifecycle/install, deterministic UI, and packaged/development Electron tests. Builds the App required by the Electron tests. |
| **Release** (`release.yml`) | Version tags or manual dispatch with an existing tag | `just check`, signed App/DMG/ZIP build, signature/version/checksum verification, publication, Homebrew installation verification, and tap sync. No full test suites. |

Run the full test suite when needed from Actions **Test → Run workflow**, select
its branch or tag, or use:

```sh
gh workflow run test.yml --ref main
```

Manual workflows must first exist on the default branch. For a tag predating
`test.yml`, select a branch containing the workflow. Re-running an old Actions
run uses its original workflow; to use a newer release workflow with an existing
tag, dispatch `release.yml` from `main` and supply that tag.

Check and Release both run the repository's `just check` entrypoint. Check stops
there; Release then builds the packages. The checks still compile Rust tooling
and run Cargo/SQLx checks, so a cold dependency cache can take time.
Release validates its tagged source independently; it does not wait for
or require a successful manual Test run. A release tag's source stays unchanged
when dispatching a newer workflow from `main`.

## Publish a version

For a local installation, `just install-app-local` uses the current `package.json`
version with a UTC `dev.YYYYMMDDHHMMSS` prerelease suffix, for example
`0.1.0-dev.20261014010203`. Existing prerelease identifiers and build metadata are
preserved. `TREEFOLD_BUILD_VERSION` overrides the generated version. The same
version is passed to the Treefold CLI/backend, Electron App, and DMG.

The Release workflow builds macOS arm64 DMG and ZIP packages with ad-hoc signing
through `just build`, verifies their signature and version, and generates
`SHA256SUMS`.

From a clean `main` checkout with dependencies installed, publish a new version:

```sh
just release 0.1.0-alpha.3
```

The script fetches origin's main and tags, rejects a checkout behind or diverged
from origin/main, and requires a SemVer version newer than both `package.json`
and every existing version tag. Local main commits ahead of origin are included.
It updates npm and Rust package versions and lockfiles plus the Treefold bundle
and CLI integration versions, creates a release commit and annotated tag, then
atomically pushes main and the tag. Dependencies, amux, and Skill versions remain
independently managed. Use `node scripts/release.ts --dry-run 0.1.0-alpha.3` to
check preconditions and preview the operation without editing files or publishing.

CI checks the committed versions against the tag before building. The tag also
supplies `TREEFOLD_BUILD_VERSION` to the existing build pipeline. Local builds
still support that override without modifying source files. Prerelease versions
are marked as prereleases and do not replace Latest. This workflow uses ordinary,
mutable GitHub Releases.

If local preparation or pushing fails, the script retains its changes for
inspection. It never resets commits, replaces tags, or force-pushes. If only the
push failed, inspect the release commit/tag and retry the printed atomic push
command from that same commit; resolve remote main changes before retrying.

The publisher creates a draft, uploads and downloads all packages to verify their
checksums, then publishes. Failed draft uploads can be retried. Already published
releases are verified, never automatically overwritten; changed packages require
a new version (or deliberate cleanup of an erroneous release).

Use Actions **Re-run failed jobs** for a failed run. If no run was created, use
**Run workflow** with the existing tag, or:

```sh
gh workflow run release.yml --ref main -f tag=v0.1.0-alpha.3
```

The manual workflow resolves and builds the specified tag, not main's source.
Publishing checks that the remote tag still points to the built commit.
To retry the legacy `v0.1.0-alpha.2` workflow, rerun its original Actions run;
its source predates the release script and current manifest-version checks.

After publication, a fresh macOS job installs the public DMG through a temporary
Homebrew tap with the exact release checksum and verifies the installed App.
After that verification succeeds, `update-tap` updates the version and SHA-256 in
`win5do/homebrew-tap`'s `Casks/treefold.rb`, commits, and pushes to its `main` branch.
The checksum comes from the public DMG that Homebrew just verified. The download
URL continues to select a fixed version; all other Cask fields are preserved.
Both prerelease and stable tags are promoted, preserving the tap's existing alpha
release policy. The App's stable-only update check is independent of this policy.

The sync skips older versions and treats a matching version/checksum as a no-op.
A different checksum for the same version fails instead of replacing a published
package. Concurrent remote changes reject the push rather than overwrite history.
If synchronization fails, the GitHub Release remains published. Fix the cause and
use **Re-run failed jobs** to retry the tap job with a fresh checkout. Run this
workflow only for tags containing `scripts/update-homebrew-tap.ts`; legacy tags
need their original workflow and a separate manual tap update.

### One-time tap credential

Create a dedicated SSH deploy key with write access on `win5do/homebrew-tap`, and
store its private key in the Treefold repository's Actions secret named
`HOMEBREW_TAP_DEPLOY_KEY`. The default `GITHUB_TOKEN` only covers the Treefold
repository and cannot push to the tap. The deploy key is scoped to the tap and is
used only by its checkout in `update-tap`; `actions/checkout` removes its temporary
SSH configuration during job cleanup. No personal access token is required.
A missing secret fails the tap job explicitly; publication is not silently marked
as fully synchronized. Remove the deploy key and Actions secret together when
retiring this automation.
