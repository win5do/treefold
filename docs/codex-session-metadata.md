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
`~/.codex/session_index.jsonl`). Treefold reads it only when the file changes,
keeps the latest valid title per ID in memory, and refreshes session lists when
those titles change. A title replaces only the default `codex` display name;
manual names and the stored Treefold name remain unchanged. Missing titles use
the existing name. Neither Codex's index nor its chat history is modified.

Project and Workspace Session lists offer **Remove from Treefold** for Codex,
including history records without a captured ID. Confirmation removes the
Treefold record and its managed process, stopping it first if necessary. A
process-removal failure preserves the record for retry. Codex-owned chat history
and Treefold's diagnostic logs are retained. Sidebar Close still only hides Codex
Sessions so they can be reopened from history.

Reference: [Codex `log_dir` configuration](https://developers.openai.com/codex/config-reference/).
