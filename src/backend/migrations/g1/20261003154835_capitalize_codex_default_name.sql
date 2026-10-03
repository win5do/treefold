-- Only rename untouched defaults; user-owned and imported titles stay unchanged.
UPDATE sessions SET name = 'Codex'
WHERE kind = 'codex' AND name = 'codex' AND agent_title_imported = 0;
