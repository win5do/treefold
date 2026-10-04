-- Preserve all previously imported/edited names as owned names.
ALTER TABLE sessions RENAME COLUMN agent_title_imported TO name_is_custom;
ALTER TABLE sessions ADD COLUMN terminal_title TEXT;
