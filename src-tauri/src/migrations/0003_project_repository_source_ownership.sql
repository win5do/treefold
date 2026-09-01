ALTER TABLE project_repositories
ADD COLUMN source_ownership TEXT NOT NULL DEFAULT 'external'
CHECK(source_ownership IN ('managed','external'));
