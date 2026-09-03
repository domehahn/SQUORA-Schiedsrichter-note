# Data deletion

Every deletion path must be tenant-safe: a request can only ever delete data
belonging to a club the caller owns, proven server-side, never by a client id.

## Delete a match / tournament (self-service, implemented)

Soft delete: `deleted_at` is set, `version` bumped, an audit row written
(`MATCH_DELETED`). The row stops appearing in every list and read
(`deleted_at IS NULL` filter) and in the whole-team sync snapshot. Hard removal
happens with the parent club.

## Remove a member (self-service, implemented)

Delete the `memberships` row (or set a non-active status). Access ends on the
member's next request — membership is re-checked per request, no session flush
needed. Audit: `MEMBER_REMOVED` (to be emitted, Epic 18).

## Delete a club (implemented — immediate hard delete)

`DELETE /api/v1/clubs/:clubId` (`cloudflare/api/clubs.ts`):

1. Requires role `club_owner` and `requireSameOrigin`; the body must confirm the
   exact club name (else 422 `CONFIRMATION_MISMATCH`).
2. A `CLUB_DELETED` audit row is written first, keeping `clubId` + `name` in
   `metadata_json` (its own `club_id` column is nulled by the cascade —
   `audit_log.club_id` FK is `ON DELETE SET NULL`).
3. `purgeClub()` (`cloudflare/services/club-deletion.ts`) deletes leaf-first
   across `match_events, matches, tournaments, players, team_drafts,
   team_rosters, team_sync_versions, teams, dfbnet_imports, memberships`, then
   the `clubs` row, in one `batch`. Returns per-table row counts.

A 30-day `status='deleting'` grace window is future work (needs a purge job).
Tests: `cloudflare/test/lifecycle.test.ts`.

## Delete a user account (implemented — tombstone)

`DELETE /api/v1/me` (`cloudflare/api/account.ts`), body `{ "confirm": "KONTO LÖSCHEN" }`:

1. Clubs the user solely owns **and** that still have other active members →
   409 `OWNER_TRANSFER_REQUIRED`; the user must transfer or delete them first.
2. Clubs the user solely owns with no other members are purged via `purgeClub`
   (audit `CLUB_DELETED`, reason `owner_account_deleted`).
3. All memberships removed; `users` row kept as a tombstone
   (`email = deleted-<id>@deleted.invalid`, `display_name = 'Gelöschtes Konto'`,
   `status = 'deleted'`); all sessions revoked; session cookie cleared.
4. `audit_log.user_id` references are retained for the audit window.
5. Audit `USER_DELETED`.

## Export before deletion

Deletion offers a final export first — see `DATA_EXPORT.md`.

## Verification

A deletion is complete only when: the entity 404s for its former members; no
child rows remain (`SELECT count(*)` per child table = 0 for that `club_id`);
an audit row records the action; the next backup no longer contains the data.
