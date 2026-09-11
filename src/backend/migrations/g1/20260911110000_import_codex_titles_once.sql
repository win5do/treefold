ALTER TABLE sessions ADD COLUMN codex_title_imported INTEGER NOT NULL DEFAULT 0 CHECK (codex_title_imported IN (0, 1));

-- Existing custom names must not be replaced by an automatic title.
UPDATE sessions SET codex_title_imported = 1 WHERE kind = 'codex' AND name <> 'codex';
