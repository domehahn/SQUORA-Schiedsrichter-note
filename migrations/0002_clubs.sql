CREATE TABLE clubs (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 20 AND 64),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  slug TEXT NOT NULL UNIQUE CHECK(length(slug) BETWEEN 2 AND 80),
  dfb_club_id TEXT CHECK(dfb_club_id IS NULL OR length(dfb_club_id) <= 120),
  cache_salt TEXT NOT NULL CHECK(length(cache_salt) BETWEEN 20 AND 64),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled', 'deleted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX clubs_status_idx ON clubs(status);

