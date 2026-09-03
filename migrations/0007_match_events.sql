CREATE TABLE match_events (
  club_id TEXT NOT NULL,
  id TEXT NOT NULL CHECK(length(id) BETWEEN 20 AND 64),
  match_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(length(event_type) BETWEEN 1 AND 40),
  match_ms INTEGER NOT NULL CHECK(match_ms >= 0),
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (club_id, id),
  FOREIGN KEY (club_id, match_id) REFERENCES matches(club_id, id) ON DELETE CASCADE
);

CREATE INDEX match_events_club_match_time_idx ON match_events(club_id, match_id, match_ms, id);

