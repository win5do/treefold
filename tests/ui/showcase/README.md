# README showcase

This directory owns the sample content and capture workflow for Treefold's public screenshots. It renders the current application in hidden Electron windows using the existing UI harness, production preload, and fixture API. It does not use a real repository, the user's Treefold database, or live Agent processes.

From the repository root, after `npm install`:

```bash
just screenshots           # English and Chinese
just screenshots en-US     # English only
just screenshots zh-CN     # Chinese only
```

Without `just`, use `npm run screenshots -- [locale]` (omit `[locale]` for both languages).

The output is five PNGs per language in `docs/images/`. English screenshots appear in `README.md`; Chinese screenshots appear in `README.zh-CN.md`.

| File | Owns |
| --- | --- |
| `fixture.ts` | Atlas sample project, worktrees, Todos, Forks, Sessions, commits, and working changes |
| `terminal.ts` | Deterministic ANSI development-server output delivered through the terminal WebSocket protocol |
| `capture.ts` | Navigation and UI interactions, dark theme, viewport, fixed clock, screenshot readiness, and cleanup |

The scenes are Project worktrees, Workspace overview, Agent creation, Git Changes with a multi-selected history context menu, and a Fork terminal with three Agent tabs and two process tabs. Keep the sample data internally consistent and use states the application actually supports. Change content in the fixture, and navigate with application controls; do not restyle the application or replace rendered content just for screenshots.

The capture command runs separately from the regression suite. Its readiness checks ensure the requested scene has loaded; screenshots are not pixel baselines. After regeneration, inspect each image for missing content, overflow, truncation, menu occlusion, and readable terminal output. Run `just typecheck` and `git diff --check` when changing the capture code. Failures save a diagnostic image under `/tmp/treefold-showcase-<locale>-failure.png`.

All windows and servers close in `finally`, and the harness removes its temporary Electron profile and build. The desktop stays hidden by default; use `TREEFOLD_TEST_HEADED=1` only when intentionally requesting visible debugging.
