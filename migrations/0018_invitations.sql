CREATE TABLE invitations (
  club_id TEXT NOT NULL,
  id TEXT NOT NULL CHECK(length(id) BETWEEN 20 AND 64),
  email TEXT NOT NULL CHECK(length(email) BETWEEN 3 AND 254),
  role TEXT NOT NULL CHECK(length(role) BETWEEN 1 AND 40),
  team_id TEXT,
  token_hash TEXT NOT NULL CHECK(length(token_hash) = 64),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'revoked', 'expired')),
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  revoked_at TEXT,
  invited_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (club_id, id),
  FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX invitations_token_idx ON invitations(token_hash);
CREATE INDEX invitations_club_status_idx ON invitations(club_id, status, created_at DESC);
CREATE UNIQUE INDEX invitations_pending_email_idx ON invitations(club_id, email) WHERE status = 'pending';
