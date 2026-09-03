CREATE TABLE dfbnet_imports (
  club_id TEXT NOT NULL,
  id TEXT NOT NULL CHECK(length(id) BETWEEN 20 AND 64),
  user_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('dfbnet_csv', 'generic_csv', 'manual')),
  filename TEXT NOT NULL CHECK(length(filename) BETWEEN 1 AND 255),
  fingerprint TEXT NOT NULL CHECK(length(fingerprint) = 64),
  status TEXT NOT NULL CHECK(status IN ('previewed', 'completed', 'failed')),
  record_count INTEGER NOT NULL DEFAULT 0 CHECK(record_count BETWEEN 0 AND 5000),
  created_at TEXT NOT NULL,
  completed_at TEXT,
  error_summary TEXT CHECK(error_summary IS NULL OR length(error_summary) <= 500),
  PRIMARY KEY (club_id, id),
  FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE (club_id, fingerprint)
);

CREATE INDEX dfbnet_imports_club_created_idx ON dfbnet_imports(club_id, created_at DESC, id);

