# Treefold for macOS

[简体中文](README.md) | **English**

**Run agents in parallel. Fold the work back cleanly.**

Treefold is a local-first macOS app for running Codex and Shell Sessions in isolated Git worktrees. Review changes, resume work, merge results, and clean up from one place.

Built for developers who already use Codex CLI and want to work on several tasks at once: each feature gets a Workspace, subtasks can run in Forks, and code, Sessions, and Todos stay attached to the work they belong to.

[Website](https://treefold.fffeng566.workers.dev/) · [Install and run](#install-and-run) · [Workflow](#workflow) · [GitHub Releases](https://github.com/win5do/treefold/releases) · [Documentation](#documentation)

If you find Treefold useful, consider [giving it a star on GitHub](https://github.com/win5do/treefold) to support the project.

## Why Treefold

- **Keep parallel work isolated.** Separate branches and worktrees for Workspaces and Forks help keep changes from different tasks apart.
- **Pick up where you left off.** Manage Codex and Shell Sessions together. Running processes survive page navigation, and Codex history can be resumed.
- **Finish and clean up.** Review changes, sync branches, handle rebases and conflicts, then merge or push according to your delivery workflow and clean up completed work.

Organize multiple repositories and context directories in one Project, and share the current work with agents through Todos, the CLI, and Skills.

## Install and run

### Requirements

- An Apple Silicon Mac running macOS Sonoma 14 or newer, plus Git.
- A configured Codex CLI for Codex Sessions. Shell Sessions work independently.

### App downloads

The first public alpha, **0.1.0-alpha.1**, is available. Install it through the [Homebrew tap](https://github.com/win5do/homebrew-tap):

```bash
brew install --cask win5do/tap/treefold
```

You can also download the [Apple Silicon DMG](https://github.com/win5do/treefold/releases/download/v0.1.0-alpha.1/Treefold-0.1.0-alpha.1-arm64.dmg), open it, and drag Treefold into Applications. The [Release page](https://github.com/win5do/treefold/releases/tag/v0.1.0-alpha.1) includes a ZIP archive, SHA-256 checksums, and release notes.

This alpha is ad-hoc signed and has not been notarized by Apple. If macOS blocks the app on first launch, choose Open Anyway in System Settings → Privacy & Security, then confirm when prompted. Use `brew upgrade --cask treefold` for future updates.

### Run from source

Install stable Rust, Node.js 24.12 or newer, Git, and `just`. The default build uses the amux Git revision pinned in Cargo.lock. For local development, `TREEFOLD_AMUX_MANIFEST` selects one source for the runtime, CLI, and Skill; see the [development setup](AGENTS.md#development-environment-and-commands).

From the repository root:

```bash
npm install
just app-dev
```

Development data defaults to `.treefold-dev/` inside the repository, separate from the usual `~/.treefold` home.

## Workflow

For a feature that needs both backend and frontend work:

1. **Create a Project.** Add local Git repositories and context directories for your agents.
2. **Create a Workspace.** Give the feature its own branch and worktrees while preserving your existing checkout.
3. **Start Sessions.** Run Codex to write code and Shell Sessions to start services, run tests, or inspect results.
4. **Create Forks as needed.** Split independent subtasks, such as an API and its UI, into separate worktrees for parallel development.
5. **Review and deliver.** Review changes and merge Fork results into the parent Workspace. Depending on repository settings, merge the Workspace locally or push its branch for remote review and CI.
6. **Finish and clean up.** Use the finish workflow to handle branch and worktree cleanup while retaining records of the work.

Remote code review and pull request merging remain on your Git hosting platform.

## Core concepts

| Concept | Purpose |
| --- | --- |
| **Project** | Groups related repositories, directories, and context. |
| **Workspace** | Owns one feature, with its own worktrees, branches, Sessions, and Todos. |
| **Fork** | Handles a parallel subtask within a Workspace and merges back into its parent. Forks cannot nest. |
| **Session** | Runs Codex or Shell in the relevant directory. A Workspace or Fork can own multiple Sessions. |

## CLI and agent collaboration

The desktop app includes the `treefold` CLI and Treefold Skill. Managed Sessions receive their current Project, Workspace, repository, and Todo context. Agents can inspect tasks, claim them, update progress, and mark them complete.

```bash
treefold open /path/to/project
treefold current --json
treefold todo list --json
treefold doctor
```

The companion `amux` runtime manages persistent processes and terminals. When creating CLI and Skill links, Treefold preserves existing user-managed paths.

## Local data and preferences

Treefold keeps Project state, Session metadata, Todos, and configuration on your Mac. Its core management workflow does not require a hosted control service. Network access by agents such as Codex depends on their services and your configuration.

Use Settings to adjust preferences and key bindings. Configuration lives under `$TREEFOLD_HOME`, which defaults to `~/.treefold`:

- `config/settings.toml`: language, theme, and agent defaults.
- `config/keymap.toml`: key binding overrides. Omitted bindings follow defaults; `false` disables a binding.

See [configuration and key bindings](docs/keymap-configuration.md) for details.

## Development and builds

```bash
just                  # List available tasks
just app-dev-watch    # Also watch Electron and Rust changes
just build            # Build the macOS app, DMG, and ZIP in release/
```

The [development guide](AGENTS.md#development-environment-and-commands) covers environment setup, amux paths, validation commands, and local installation. UI tests run in hidden Electron windows by default.

## Documentation

- [Project, Workspace, and Fork model](docs/project-workspace-model.md)
- [Git worktree lifecycle](docs/git-worktree-lifecycle.md)
- [Agent Skills, CLI, and App API](docs/agent-skill-cli-api-architecture.md)
- [Frontend and backend communication](docs/frontend-backend-communication.md)

## License

Copyright (C) 2026 [win5do](https://github.com/win5do).

Treefold is licensed under the [GNU Affero General Public License v3.0 only](LICENSE) (AGPL-3.0-only).
