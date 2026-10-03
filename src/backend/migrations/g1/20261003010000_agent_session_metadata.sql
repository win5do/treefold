ALTER TABLE sessions RENAME COLUMN codex_session_id TO agent_session_id;
ALTER TABLE sessions RENAME COLUMN codex_title_imported TO agent_title_imported;
-- Existing custom names must remain user-owned after the generic worker is enabled.
UPDATE sessions SET agent_title_imported=1
WHERE name != CASE kind WHEN 'codex' THEN 'codex' WHEN 'claude_code' THEN 'Claude Code'
    WHEN 'opencode' THEN 'OpenCode' WHEN 'pi' THEN 'Pi' ELSE '' END;
