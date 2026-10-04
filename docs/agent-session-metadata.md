# Agent Sessions and metadata

## Ownership

`agents/mod.rs` owns CLI adapters. `agents/hooks.rs` prepares process-local
integrations and accepts native callbacks; `server/agent_metadata.rs` commits
Treefold-owned identity receipts. No adapter scans Agent logs, title indexes,
transcripts or directory timestamps to discover an ID.

`session_title.rs` parses terminal OSC 0/2 and coalesces title writes.
`server/session_titles.rs` observes amux output independently of mounted Tabs.
The renderer uses one `sessionDisplayName` helper for the sidebar and history lists.

## Exact conversation association

| Agent | Official callback | Resume |
| --- | --- | --- |
| Codex | `SessionStart` / `UserPromptSubmit` command Hook, `session_id` | `resume <native-id>` |
| Claude Code | Process-local plugin with `SessionStart` / `UserPromptSubmit`, `session_id` | `--resume <native-id>` |
| OpenCode 2 | TUI extension reads the current Session route and verifies it through `context.data.session.get` | `--session <native-id>` |
| Pi | `session_start` extension event and `ctx.sessionManager.getSessionId()` | Managed absolute Session file |

The fixed Hook command invokes the bundled backend's `--agent-hook` mode.
Per-launch environment supplies its path, runtime directory and launch token;
Hook definitions contain no changing UUIDs. Unchanged integration files are not
rewritten. Receipts are private atomic files under
`$TREEFOLD_HOME/data/agent-sessions/<kind>/<treefold-id>/`. The receiver rejects
stale launch tokens, wrong Agent kinds and conflicting saved identities.

Native review/trust still applies. Treefold does not approve Hook definitions,
trust workspaces, or enable disabled extensions. With no callback, there is no
new `agent_session_id` and Resume returns HTTP 409 before replacing a process.
The Session remains visible and can still be opened or removed. Existing saved
IDs are retained on upgrade. A supplied Claude `--session-id` alone does not
count as a confirmed identity.

Codex uses a process-local server (`--no-daemon`) so callbacks receive this
launch's environment. OpenCode also uses `--standalone` so generated instructions
reach its own server. Its **TUI** extension runs in the local terminal, so a shared native server cannot bind a different terminal's Session.
`OPENCODE_CLI_CONFIG_CONTENT` and inline JSONC overrides are preserved in generated
process-local config. The native `cli.json` plugin list and disable rules are
retained; original user files are never rewritten. Pi's explicit
`--no-extensions` / `-ne` prevents injecting the Treefold extension.

Treefold retains the first root association. Native new/switch/fork operations
remain available but do not replace Treefold's saved Resume target. This is a
limitation: the observed terminal title can describe a switched native Session.
Create separate Treefold Sessions when each conversation needs its own Resume.

Pi Resume validates the already-known ID against its managed file before
replacing a process. After stopping the old process, it atomically updates only
that file's header cwd so a removed worktree does not break Resume. This reads
native history to validate/relocate a known target, never to discover its ID.

## Titles and persistence

- Display priority: explicit name, latest useful terminal title (including the
  last persisted title), then `name · last 8 characters of the Treefold ID`.
- `name_is_custom` records explicit ownership, including a rename to `Codex`.
  `terminal_title` is separate and never overwrites `name`.
- Live title observation runs every two seconds, including unopened Tabs.
  Changes are saved after five quiet seconds, with a maximum thirty-second wait
  during continuous changes. Stop/Close and graceful backend exit flush changes.
  A forced crash can lose the unsaved window; retained amux output is replayed
  on reconnect.
- Empty titles, product-only placeholders and Claude spinner-only changes do
  not replace the last useful title. The parser handles fragmented UTF-8, BEL
  and ST terminators and bounds input/title size.
- A forward-only migration retains previous imported/custom names and native
  IDs, renames the ownership flag and adds `terminal_title`.

## Shared behavior

- Every Agent receives the Treefold Project/Workspace/Fork snapshot, locations,
  read/write labels, Todo scope, and lifecycle ownership instructions. The shared
  CLI environment also allows `treefold current --json` and Todo operations.
- Codex uses developer instructions; Claude Code and Pi append a system prompt;
  OpenCode reads the generated instruction file. The user's initial prompt is
  supplied only on a new launch, never replayed by Resume.
- Codex and Claude Code accept native additional-directory arguments. OpenCode
  and Pi receive the paths through the common context and use their native tool
  permissions. Treefold does not replace those permission systems.
- All Agent resumes refresh the current writable directory list. Read-only
  locations remain context; the instructions explicitly forbid modifying them.
- All Agent TUIs wait for a controlling terminal to report valid dimensions.
  Provider-specific keyboard mappings live in renderer Agent implementations;
  Codex retains its Ctrl+J fallback for Shift+Enter.
- Close stops/removes the managed process and hides the record. Remove from
  Treefold deletes the record/process, retaining native history and runtime files.
- Delivery with history retention stops all Agent processes, hides their records,
  and relocates their cwd when the worktree is removed. Without history retention,
  Session records are deleted.

Todo Fork launch and conflict resolution accept an optional `agent_kind` query
parameter. The UI exposes the installed Agent choices in configured order. When
omitted, the backend chooses the first installed Agent in that order. Conflict
resolution uses `/api/parent-operations/{id}/resolve-with-agent`; the old
`resolve-with-codex` route remains an alias for existing clients. An existing
resolver Session is reused.

## Verification boundaries

The integration fixture runs inert CLIs through the real backend, adapters and
amux. It executes the generated callbacks/extensions, observes OSC titles,
checks retained titles, exact Resume arguments and rejects Resume when native
files exist but no callback was received. This does not replace native CLI
trust/compatibility testing. Focused tests cover stale/wrong callbacks, viewed
OpenCode roots, observer disposal, bounded title parsing, write coalescing,
forward migration, JSONC preservation and Pi relocation.

The integration fixture exercises single-process Stop/Resume without a keeper
Shell. It requires the accompanying amux lifecycle fix: terminal notifications
drain before the group closes, daemon observations do not overwrite metadata,
and removal waits for terminal state to be observed. Stopped records retain
their names until deletion; the fix preserves the existing name uniqueness rule.

## References

- [Codex Hooks](https://learn.chatgpt.com/docs/hooks)
- [Claude Code Hooks](https://code.claude.com/docs/en/hooks)
- [OpenCode TUI plugin API](https://github.com/anomalyco/opencode/blob/v2/packages/plugin/src/tui/context.ts)
- [OpenCode TUI configuration](https://github.com/anomalyco/opencode/blob/v2/services/www/src/docs/content/cli/plugins.mdx)
- Pi 1.0.0 extension types in `@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`
