# Agent Sessions and metadata

## Ownership

`agents/mod.rs` owns the adapter contract and dispatch. Each provider owns its
CLI arguments, launch resources, native metadata parser and resume validation
under `agents/<provider>/`. `server/agent_metadata.rs` schedules bounded reads,
commits discovered metadata and publishes changes; it does not parse vendor files.
Session creation, context generation, directory refresh, Close, Stop, Resume and
delivery are shared workflows.

Generation 1 adds a forward migration renaming `codex_session_id` to
`agent_session_id` and `codex_title_imported` to `agent_title_imported`, preserving
existing values. The Session API now exposes `agent_session_id` for every Agent.
All renderer consumers use that field. Existing custom names are marked handled.

## Exact conversation association

| Agent | Initial launch association | Resume | Title source |
| --- | --- | --- | --- |
| Codex | Scoped `logs/codex/<treefold-id>/codex-tui.log`; exact runtime-context fallback in Codex history | `resume <native-id>` | `$CODEX_HOME/session_index.jsonl` |
| Claude Code | Explicit `--session-id <UUID>` derived from the Treefold ID; matching transcript under `$CLAUDE_CONFIG_DIR/projects` (default `~/.claude/projects`) | `--resume <native-id>` | Transcript `custom-title`, then `summary` |
| OpenCode | A per-Session plugin binds the first root `chat.message` hook after verifying the Session through the native client; metadata events cannot establish identity | `--session <native-id>` | Verified Session title, then matching `session.updated` events |
| Pi | Explicit `--session <absolute-file>` under the managed runtime directory; native header ID | The same absolute Session file, with its header cwd updated to the current checkout | Latest `session_info.name` |

Additional runtime resources live in
`$TREEFOLD_HOME/data/agent-sessions/<kind>/<treefold-id>/`. OpenCode receives the
plugin and a generated instruction file through `OPENCODE_CONFIG_CONTENT`, merged
with inherited inline JSONC configuration (including comments and trailing commas).
Resume validates that configuration before removing the old process.
Existing plugins, instructions, models and
permissions are retained. These are per-process overrides; user config files and
repository instructions are not rewritten.

No adapter associates history using only cwd or timestamps. Existing non-Codex
Sessions created before this integration have no exact launch association; their
records remain available, but Resume returns an identity-pending error. New
Sessions establish the required association. Missing Pi history or a different
header ID is rejected before replacing the old process, because Pi would otherwise
create a new conversation at a missing path.

Treefold Resume reopens the saved native conversation. Native CLI operations such
as new, switch and fork remain available; Treefold does not follow those switches
or replace its saved association. OpenCode ignores unrelated creation/title events
and user messages from other conversations when collecting metadata.
Resume supplies the persisted native ID even if the metadata sidecar was lost.
Blank OpenCode Sessions acquire identity on their first root user message.

On Pi Resume, after the old process stops, Treefold atomically updates only the
managed history header's cwd; the native ID, other header fields
and transcript bytes are preserved. Pi otherwise prefers the old header cwd over
the child process cwd, which can point to a removed worktree.

Metadata adapters follow the CLI file/event formats and can require updates when
those formats change. Codex fallback scanning and title-index reading are batched.
Claude Code and Pi read bounded header/tail windows so titles appended to long
histories can still be found. Missing or malformed metadata leaves capture pending.

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
- Treefold imports the first available native title once. It does not synthesize
  titles for Agents that have not produced one. Manual names and renames are
  never overwritten, even if the user renames back to the default label.
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
amux. It checks launch arguments, context, exact native IDs, title import and
Resume for all four providers. Claude Code and OpenCode were not installed on the
verification machine, so this does not establish model-backed native CLI acceptance.
Focused regressions cover unrelated OpenCode events, native switching while
retaining the saved association, lost metadata on Resume, JSONC parsing,
preserving a running process when Resume rejects invalid inline configuration
and Pi's persisted cwd.

The integration fixture exercises single-process Stop/Resume without a keeper
Shell. It requires the accompanying amux lifecycle fix: terminal notifications
drain before the group closes, daemon observations do not overwrite metadata,
and removal waits for terminal state to be observed. Stopped records retain
their names until deletion; the fix preserves the existing name uniqueness rule.

## References

- [Claude Code CLI](https://code.claude.com/docs/en/cli-reference)
- [OpenCode config](https://opencode.ai/docs/config/)
- [OpenCode plugins](https://opencode.ai/docs/plugins/)
- Pi 1.0.0 `--help` and `core/session-manager.js` from `@earendil-works/pi-coding-agent`
- [Codex log configuration](https://developers.openai.com/codex/config-reference/)
