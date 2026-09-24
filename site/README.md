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
History squash and Finish-time squash delivery, plus
`../docs/positioning-and-messaging.md` and
`../src/renderer/src/i18n/AGENTS.md`.
