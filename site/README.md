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
home or download page. The site currently links to the private
`win5do/treefold` repository and the private `win5do/tap` Homebrew tap. The
release page is empty, so the download page explicitly marks both installation
methods as pending. Before public launch, publish an installable Release, verify
the tap's version and checksum against its DMG, and replace the private-release
notice. The Cask currently supports Apple Silicon and macOS Sonoma or newer.

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
