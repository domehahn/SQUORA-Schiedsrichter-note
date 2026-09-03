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

## Delete a club (request-based, endpoint pending)

Target flow:

1. `club_owner` requests deletion → `clubs.status='deleting'`, `deletion_due_at`
   = now + 30 days. Club disappears from `listClubs`; all APIs return 404.
2. Grace window: the owner can cancel.
3. After the window a job hard-deletes the club row; `ON DELETE CASCADE` on
   `memberships`, `teams`, `matches`, `match_events`, `tournaments`,
   `players`, `dfbnet_imports`, `team_*` removes every child.
4. `audit_log` rows with that `club_id` are retained (metadata only) for the
   audit window, then trimmed.

## Delete a user account (request-based, endpoint pending)

1. If the user is the sole `club_owner` of any club, require transfer or club
   deletion first.
2. `users.status='deleted'`, e-mail and display name replaced with a tombstone
   (`deleted-user-<id>`), all sessions revoked, all memberships removed.
3. `audit_log.user_id` references are retained (id only) for the audit window.

## Export before deletion

Deletion offers a final export first — see `DATA_EXPORT.md`.

## Verification

A deletion is complete only when: the entity 404s for its former members; no
child rows remain (`SELECT count(*)` per child table = 0 for that `club_id`);
an audit row records the action; the next backup no longer contains the data.
