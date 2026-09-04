CREATE TABLE legacy_migrations (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 20 AND 64),
  user_id TEXT NOT NULL,
  club_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  legacy_tenant_id TEXT NOT NULL CHECK(length(legacy_tenant_id) BETWEEN 1 AND 64),
  source_fingerprint TEXT NOT NULL CHECK(length(source_fingerprint) = 64),
  status TEXT NOT NULL CHECK(status IN ('started', 'completed', 'failed')),
  record_count INTEGER NOT NULL DEFAULT 0 CHECK(record_count BETWEEN 0 AND 10000),
  created_at TEXT NOT NULL,
  completed_at TEXT,
  error_code TEXT CHECK(error_code IS NULL OR length(error_code) <= 80),
  UNIQUE (user_id, legacy_tenant_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (club_id, team_id) REFERENCES teams(club_id, id) ON DELETE CASCADE
);

CREATE INDEX legacy_migrations_target_idx ON legacy_migrations(club_id, team_id, status);

