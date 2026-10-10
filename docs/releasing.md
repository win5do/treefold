# Releasing Treefold

The Release workflow builds macOS arm64 DMG and ZIP packages with ad-hoc signing.
It checks the repository, runs tests, builds through `just build`, verifies the
packaged Electron lifecycle and signature, and generates `SHA256SUMS`.

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
Update `win5do/homebrew-tap`'s `Casks/treefold.rb` version and SHA-256 to promote
that package to the public tap. Cross-repository tap updates are not performed by
the workflow and need no additional credential stored in this repository.
