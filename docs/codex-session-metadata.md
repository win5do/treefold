# Codex Session metadata and removal

Treefold launches each Codex Session with an explicit `log_dir` under
`$TREEFOLD_HOME/logs/codex/<treefold-session-id>`. Codex writes its plaintext
`codex-tui.log` there; it contains diagnostic data and may contain conversation
content. Other Codex invocations retain their own logging configuration.

Identity capture reads the root `session_loop` creation record from this scoped
log. This works before the first user message and after the process exits.
Malformed IDs, nested spans, and conflicting root identities are rejected. The
adapter is based on the installed Codex log format; it is not a stable protocol.
If it cannot identify the launch, Treefold retains the existing fallback that
matches the exact Treefold ID in persisted developer runtime context. It never
infers ownership from a working directory or timestamp alone. Existing records
without either source of evidence remain unidentified.

Codex automatic titles come from `$CODEX_HOME/session_index.jsonl` (default
`~/.codex/session_index.jsonl`). Treefold imports the first available valid title
into the Session's database name and records `codex_title_imported=1`. Later
Codex title changes do not affect that Session, including across backend restarts.
Manual renames also mark the title as handled, even when renamed back to `codex`.

Only Sessions with a captured Codex ID, the default name, and no imported title
are eligible. While any eligible Sessions remain, the metadata worker checks for
their first title; missing titles leave them pending. With no eligible Sessions,
it does not read or stat the title index. Neither Codex's index nor chat history
is modified. The independent ID-capture worker continues to run.

Project and Workspace Session lists offer **Remove from Treefold** for Codex,
including history records without a captured ID. Confirmation removes the
Treefold record and its managed process, stopping it first if necessary. A
process-removal failure preserves the record for retry. Codex-owned chat history
and Treefold's diagnostic logs are retained. Sidebar Close still only hides Codex
Sessions so they can be reopened from history.

Reference: [Codex `log_dir` configuration](https://developers.openai.com/codex/config-reference/).
