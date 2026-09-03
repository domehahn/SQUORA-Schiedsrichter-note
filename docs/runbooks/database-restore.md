# Runbook — D1 database restore

## Objectives

| Metric | Target |
| --- | --- |
| RPO (max data loss) | ≤ 5 minutes (D1 Time Travel bookmark granularity) |
| RTO (time to serve again) | ≤ 60 minutes for a single-DB restore |

## Backup mechanism

- **D1 Time Travel** — Cloudflare retains a continuous change history for ~30
  days. No cron backup job is required for point-in-time recovery inside that
  window.
- **Weekly logical export** — `wrangler d1 export` to an encrypted off-platform
  bucket, retained 90 days, for recovery beyond the Time Travel window and for
  migration/audit. (Job to be scheduled — see Production Readiness.)

## Restore procedures

### A. Point-in-time (within ~30 days) — preferred

```
# find a bookmark or timestamp just before the incident
wrangler d1 time-travel info   schiedsrichter-note-production --env production
wrangler d1 time-travel restore schiedsrichter-note-production --env production \
  --timestamp "2026-09-03T18:40:00Z"     # or --bookmark <id>
```

This rewinds the **same** database in place. Announce a short read-only/maintenance
window first; in-flight optimistic-lock versions will move backwards, so clients
must reload (the app already surfaces `VERSION_CONFLICT` and re-syncs).

### B. From a logical export (older than Time Travel, or DB lost)

```
wrangler d1 create schiedsrichter-note-production-restore
wrangler d1 execute schiedsrichter-note-production-restore --file backup-YYYYMMDD.sql --remote
wrangler d1 migrations apply schiedsrichter-note-production-restore --remote   # bring schema current
# point wrangler.jsonc production binding at the new database_id, deploy
```

## Verification checklist (run after every restore)

1. `SELECT count(*)` on `users, clubs, memberships, teams, matches, match_events,
   tournaments, sessions, audit_log` — compare to pre-incident monitoring.
2. Latest `audit_log.created_at` is at/after the chosen restore point.
3. Log in as a known test account; `GET /api/v1/clubs` returns the expected set.
4. Open one club/team; archive, tournaments and any live draft load.
5. Cross-tenant probe: a foreign club id still 404s.
6. `PRAGMA foreign_key_check;` returns no rows.
7. Sessions from before the restore behave correctly (valid ones still work,
   revoked ones still fail).

## Staging rehearsal (required before production readiness)

Quarterly: take a staging export, restore it into a throwaway DB via procedure B,
run the verification checklist and the worker test suite against it, record the
measured RTO in the release log. A documented-but-unrehearsed restore does not
count as ready.

## Communication

Post start / ETA / completion in the ops channel. If personal data may have been
exposed or lost, trigger `docs/runbooks/incident-response.md`.
