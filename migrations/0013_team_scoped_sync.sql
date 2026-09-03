-- Isolate synchronised data (archive, tournaments, live match + clock) per team
-- (Jugend/Mannschaft) within a club. A club has many teams. Each team's data
-- never mixes with another team's, and no client can touch another team's clock.

PRAGMA foreign_keys = ON;

-- Optional team scoping for memberships: NULL means club-wide, otherwise limited to one team.
ALTER TABLE memberships ADD COLUMN team_id TEXT;

ALTER TABLE matches ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
ALTER TABLE match_events ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
ALTER TABLE tournaments ADD COLUMN team_id TEXT NOT NULL DEFAULT '';

CREATE INDEX matches_team_date_idx ON matches(club_id, team_id, match_date DESC, id);
CREATE INDEX match_events_team_idx ON match_events(club_id, team_id, match_id, match_ms, id);
CREATE INDEX tournaments_team_date_idx ON tournaments(club_id, team_id, tournament_date DESC, id);

DROP TABLE IF EXISTS club_drafts;
DROP TABLE IF EXISTS club_sync_versions;

CREATE TABLE team_sync_versions (
  club_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0 CHECK(version >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (club_id, team_id),
  FOREIGN KEY (club_id, team_id) REFERENCES teams(club_id, id) ON DELETE CASCADE
);

CREATE TABLE team_drafts (
  club_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  match_id TEXT NOT NULL CHECK(length(match_id) BETWEEN 20 AND 64),
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (club_id, team_id),
  FOREIGN KEY (club_id, team_id) REFERENCES teams(club_id, id) ON DELETE CASCADE
);

-- The client-side team library (opponent rosters) for one team, stored as one
-- opaque blob. Sensitive DFBnet metadata is stripped before it is written here.
CREATE TABLE team_rosters (
  club_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (club_id, team_id),
  FOREIGN KEY (club_id, team_id) REFERENCES teams(club_id, id) ON DELETE CASCADE
);
