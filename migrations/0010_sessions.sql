CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY CHECK(length(id_hash) = 64),
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  user_agent TEXT CHECK(user_agent IS NULL OR length(user_agent) <= 300),
  ip_hash TEXT CHECK(ip_hash IS NULL OR length(ip_hash) = 64),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX sessions_user_active_idx ON sessions(user_id, revoked_at, expires_at);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);

