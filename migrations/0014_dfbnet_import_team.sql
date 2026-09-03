-- Associate each DFBnet import with the team (Jugend) it targeted, so import
-- history is scoped the same way roster data is and a team-scoped member never
-- sees another team's imports.

ALTER TABLE dfbnet_imports ADD COLUMN team_id TEXT NOT NULL DEFAULT '';

CREATE INDEX dfbnet_imports_team_idx ON dfbnet_imports(club_id, team_id, created_at DESC, id);
