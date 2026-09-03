CREATE TABLE audit_log (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 20 AND 64),
  club_id TEXT,
  user_id TEXT,
  action TEXT NOT NULL CHECK(length(action) BETWEEN 1 AND 80),
  entity_type TEXT NOT NULL CHECK(length(entity_type) BETWEEN 1 AND 80),
  entity_id TEXT CHECK(entity_id IS NULL OR length(entity_id) <= 64),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX audit_log_club_created_idx ON audit_log(club_id, created_at DESC, id);
CREATE INDEX audit_log_user_created_idx ON audit_log(user_id, created_at DESC, id);

