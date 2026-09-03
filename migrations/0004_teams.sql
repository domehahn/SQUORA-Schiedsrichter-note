CREATE TABLE teams (
  club_id TEXT NOT NULL,
  id TEXT NOT NULL CHECK(length(id) BETWEEN 20 AND 64),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  dfb_team_id TEXT CHECK(dfb_team_id IS NULL OR length(dfb_team_id) <= 120),
  age_group TEXT CHECK(age_group IS NULL OR length(age_group) <= 40),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (club_id, id),
  FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE
);

CREATE INDEX teams_club_updated_idx ON teams(club_id, updated_at DESC);

