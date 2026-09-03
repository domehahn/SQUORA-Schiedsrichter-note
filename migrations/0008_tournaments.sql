CREATE TABLE tournaments (
  club_id TEXT NOT NULL,
  id TEXT NOT NULL CHECK(length(id) BETWEEN 20 AND 64),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  tournament_date TEXT CHECK(tournament_date IS NULL OR length(tournament_date) <= 40),
  payload_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (club_id, id),
  FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE
);

CREATE INDEX tournaments_club_date_idx ON tournaments(club_id, tournament_date DESC, id);

