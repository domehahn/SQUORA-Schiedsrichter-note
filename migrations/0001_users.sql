PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 20 AND 64),
  email TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(email) BETWEEN 3 AND 254),
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 120),
  password_hash TEXT NOT NULL CHECK(length(password_hash) BETWEEN 40 AND 512),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'invited', 'disabled', 'deleted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE INDEX users_status_idx ON users(status);

