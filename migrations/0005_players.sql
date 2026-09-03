CREATE TABLE players (
  club_id TEXT NOT NULL,
  id TEXT NOT NULL CHECK(length(id) BETWEEN 20 AND 64),
  team_id TEXT NOT NULL,
  external_id TEXT CHECK(external_id IS NULL OR length(external_id) <= 120),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  shirt_number TEXT CHECK(shirt_number IS NULL OR length(shirt_number) <= 8),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (club_id, id),
  FOREIGN KEY (club_id, team_id) REFERENCES teams(club_id, id) ON DELETE CASCADE,
  UNIQUE (club_id, team_id, external_id)
);

CREATE INDEX players_club_team_idx ON players(club_id, team_id, name);

