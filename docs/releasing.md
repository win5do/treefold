# Releasing Treefold

The Release workflow builds macOS arm64 DMG and ZIP packages with ad-hoc signing.
It checks the repository, runs tests, builds through `just build`, verifies the
packaged Electron lifecycle and signature, and generates `SHA256SUMS`.

Push an existing main commit as an annotated SemVer tag to publish it:

```sh
git tag -a v0.1.0-alpha.2 -m 'Treefold v0.1.0-alpha.2'
git push origin v0.1.0-alpha.2
```

The tag supplies `TREEFOLD_BUILD_VERSION`; it overrides the development version
without changing manifests. Prerelease versions are marked as prereleases and do
not replace Latest. This workflow uses ordinary, mutable GitHub Releases.

The publisher creates a draft, uploads and downloads all packages to verify their
checksums, then publishes. Failed draft uploads can be retried. Already published
releases are verified, never automatically overwritten; changed packages require
a new version (or deliberate cleanup of an erroneous release).

Use Actions **Re-run failed jobs** for a failed run. If no run was created, use
**Run workflow** with the existing tag, or:

```sh
gh workflow run release.yml --ref main -f tag=v0.1.0-alpha.2
```

The manual workflow resolves and builds the specified tag, not main's source.
Publishing checks that the remote tag still points to the built commit.

After publication, a fresh macOS job installs the public DMG through a temporary
Homebrew tap with the exact release checksum and verifies the installed App.
Update `win5do/homebrew-tap`'s `Casks/treefold.rb` version and SHA-256 to promote
that package to the public tap. Cross-repository tap updates are not performed by
the workflow and need no additional credential stored in this repository.
