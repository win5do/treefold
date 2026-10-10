# Treefold product site

The standalone Astro site lives in `site/`. It does not share the desktop App's
Electron renderer or build output.

```sh
cd site
npm install
npm run dev
npm run check
npm run build
```

The Chinese pages are `/` and `/download`; English equivalents live at `/en/`
and `/en/download/`. The header language switch keeps visitors on the matching
home or download page. Treefold 0.1.0-alpha.1 is available from the public
`win5do/treefold` GitHub Releases and the `win5do/tap` Homebrew tap. The download
page links directly to the DMG and shows the Homebrew installation command.
Release version and download URLs live in `src/config/site.ts`; update them
alongside the tap's version and DMG checksum for each release. The Cask supports
Apple Silicon and macOS Sonoma or newer. Keep the ad-hoc signing and first-launch
instructions visible until Developer ID signing and Apple notarization are enabled.

The homepage uses labeled workflow and Git illustrations rather than App
screenshots. Product copy follows the current implementation, including Git
History squash and Finish-time squash delivery. Follow the messaging guidance
below and the [localization guide](../src/renderer/src/i18n/AGENTS.md).

## Product messaging

Use these brand taglines across the site, README, and release introductions:

- Chinese: **并行展开，干净收敛。**
- English: **Run agents in parallel. Fold the work back cleanly.**

The audience is developers who already use Agent CLIs and Git worktrees and need
to manage parallel branches, directories, Sessions, conflicts, and cleanup.
Lead with isolated work, resumable Sessions, and the worktree lifecycle from
creation through delivery and cleanup. Work belongs to a Workspace beyond any
single Session: **Sessions are disposable. Work should be durable.**

UI panels, the embedded terminal, History, and Todo support that workflow;
they are not the primary selling points. Describe Treefold as a local-first
worktree and Agent Session manager, not a complete Git GUI or a replacement for
Git hosting, code review, CI, or native Agent conversation history. Project state
and orchestration data stay local; Agent network access depends on its provider
and configuration, so do not claim that code never leaves the machine.

## Product illustrations

The Hero follows one task through splitting, parallel execution, and review /
delivery. Its radio controls support pointer and keyboard navigation without
autoplay. The illustration uses sample data, not a live App session.

The operating-model section embeds the bilingual product architecture. Both
READMEs reference the same SVG assets in `public/diagrams/`. Narrow screens use
vertically arranged diagrams. To edit and regenerate all four assets:

```bash
node site/scripts/generate-product-architecture.ts
```

Run the generator from the repository root. Diagram text and layout are owned by
that script; commit regenerated SVGs together with source changes.
