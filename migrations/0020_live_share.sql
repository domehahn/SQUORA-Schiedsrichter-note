ALTER TABLE team_drafts ADD COLUMN share_token_hash TEXT;

CREATE UNIQUE INDEX team_drafts_share_token_idx ON team_drafts(share_token_hash) WHERE share_token_hash IS NOT NULL;
