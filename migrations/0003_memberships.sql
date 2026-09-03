CREATE TABLE memberships (
  club_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('club_owner', 'club_admin', 'referee_manager', 'referee', 'viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('invited', 'active', 'suspended', 'removed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (club_id, user_id),
  FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX memberships_user_status_idx ON memberships(user_id, status);
CREATE INDEX memberships_club_status_idx ON memberships(club_id, status);

