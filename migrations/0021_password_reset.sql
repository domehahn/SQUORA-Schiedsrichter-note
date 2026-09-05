CREATE TABLE password_reset_tokens (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 20 AND 64),
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL CHECK(length(token_hash) = 64),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX password_reset_tokens_token_idx ON password_reset_tokens(token_hash);
CREATE INDEX password_reset_tokens_user_idx ON password_reset_tokens(user_id, created_at DESC);
