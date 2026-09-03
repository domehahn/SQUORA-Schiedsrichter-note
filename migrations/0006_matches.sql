CREATE TABLE matches (
  club_id TEXT NOT NULL,
  id TEXT NOT NULL CHECK(length(id) BETWEEN 20 AND 64),
  external_id TEXT CHECK(external_id IS NULL OR length(external_id) <= 120),
  home_team_id TEXT,
  away_team_id TEXT,
  match_date TEXT NOT NULL CHECK(length(match_date) <= 40),
  competition TEXT NOT NULL DEFAULT '' CHECK(length(competition) <= 160),
  venue TEXT NOT NULL DEFAULT '' CHECK(length(venue) <= 200),
  state TEXT NOT NULL CHECK(state IN ('setup', 'live', 'finished', 'abandoned')),
  payload_json TEXT NOT NULL DEFAULT '{}',
  private_notes_ciphertext TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (club_id, id),
  FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE,
  FOREIGN KEY (club_id, home_team_id) REFERENCES teams(club_id, id),
  FOREIGN KEY (club_id, away_team_id) REFERENCES teams(club_id, id),
  UNIQUE (club_id, external_id)
);

CREATE INDEX matches_club_date_idx ON matches(club_id, match_date DESC, id);
CREATE INDEX matches_club_updated_idx ON matches(club_id, updated_at DESC);

