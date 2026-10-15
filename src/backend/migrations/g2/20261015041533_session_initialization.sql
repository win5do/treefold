ALTER TABLE sessions ADD COLUMN initializing INTEGER NOT NULL DEFAULT 0 CHECK (initializing IN (0, 1));
ALTER TABLE sessions ADD COLUMN initialization_error TEXT;
