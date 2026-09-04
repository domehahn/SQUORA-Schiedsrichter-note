ALTER TABLE clubs ADD COLUMN deletion_due_at TEXT;
CREATE INDEX clubs_deletion_due_idx ON clubs(deletion_due_at);
