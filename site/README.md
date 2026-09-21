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

The pages are `/` and `/download`. The site currently links to the private
`win5do/treefold` repository and the private `win5do/tap` Homebrew tap. The
release page is empty, so the download page explicitly marks both installation
methods as pending. Before public launch, publish an installable Release, verify
the tap's version and checksum against its DMG, and replace the private-release
notice. The Cask currently supports Apple Silicon and macOS Sonoma or newer.

The hero contains a labeled workflow illustration, not an App screenshot. Product
copy follows `../docs/positioning-and-messaging.md` and
`../src/renderer/src/i18n/AGENTS.md`.
