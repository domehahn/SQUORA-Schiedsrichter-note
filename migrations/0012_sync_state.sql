ALTER TABLE teams ADD COLUMN payload_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE matches ADD COLUMN saved_at TEXT;

CREATE TABLE club_drafts (
  club_id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL CHECK(length(match_id) BETWEEN 20 AND 64),
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE
);

CREATE TABLE club_sync_versions (
  club_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 0 CHECK(version >= 0),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE
);

