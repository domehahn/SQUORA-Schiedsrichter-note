# Tenant model

## Hierarchy

```
user
 └── membership (club_id, user_id, role, status, team_id?)
       └── club
             ├── team (Jugend/Mannschaft)   PK (club_id, id)
             │     ├── matches / match_events      (club_id, team_id, …)
             │     ├── tournaments
             │     ├── team_sync_versions          aggregate optimistic-lock counter
             │     ├── team_drafts                 live match + clock
             │     └── team_rosters                opponent roster library (minimized)
             ├── players
             ├── dfbnet_imports
             └── audit_log
```

- **Club** is the billing/ownership tenant. **Team** is the data-isolation unit
  inside a club: D1, D2, E1 each keep their own archive, tournaments, live match
  and clock. One team's sync never reads, writes or version-conflicts another's.
- `memberships.team_id` is optional. `NULL` = club-wide membership (sees every
  team). Set = the member may only reach that one team; sibling teams return
  404.

## The authorization chain

Every club- or team-scoped request runs, in order:

1. `requireAuth` — valid, unrevoked, unexpired session; `users.status='active'`.
2. Membership resolution — `memberships` row with `status='active'` and
   `clubs.status='active'`; for team routes also `(team_id IS NULL OR team_id=?)`
   and the `teams` row must exist.
3. Permission check — `ROLE_PERMISSIONS[role]` must include the required
   `Permission`; otherwise 403 `PERMISSION_DENIED`.
4. Tenant-scoped query — `club_id` (and `team_id`) bound in the same statement.
5. Database constraints — composite PKs/FKs reject any cross-tenant row that
   slipped through.

A failure at steps 1–2 is indistinguishable from "resource does not exist":
**404**, never 403, so a foreign club/team/match id cannot be probed.

## Untrusted inputs

Club id, team id, match id, import id, request body, cursor, browser storage and
frontend state are all untrusted. They may select *which* of the caller's own
resources to act on; they may never *grant* access. The client's cached club/team
list is a UI convenience only — `listClubs` / `listTeams` re-derive it from
active memberships on every load.

## Membership & account lifecycle

- `users.status`: `active` → `disabled` → `deleted`. A `disabled` user's existing
  sessions stop working on the next request (join condition in `optionalAuth`).
- `memberships.status`: `active` is required everywhere. Removing the row or
  setting any non-active status revokes access immediately — no session flush
  needed, because membership is re-checked per request.

## Legacy migration

Pre-D1 clients hold a client-generated tenant id and an encrypted KV blob.
`legacy/kv-migration.ts` exposes that blob **read-only**, keyed by the login
e-mail, and it is never treated as proof of membership. Migration is an explicit,
user-confirmed action in the unlock gate that writes the blob into a chosen
`(club, team)` via the normal authorized `PUT …/state` path. The source KV
record is not deleted.
