# Runbook — incident response

Scope: security incidents and personal-data incidents for SQUORA Schiedsrichter
Note (cross-tenant exposure, account compromise, data loss, leaked secret,
malicious import).

## Severity

| Sev | Definition | Examples |
| --- | --- | --- |
| SEV-1 | Confirmed cross-tenant data exposure, auth bypass, or secret leak | User A read/observed Club B data; session forgery; `AUTH_USERS` / pepper in a public place |
| SEV-2 | Likely but unconfirmed exposure, or data loss with a working restore path | Suspicious audit pattern; a dropped table with Time Travel available |
| SEV-3 | Contained weakness, no evidence of exploitation | Dependency CVE; a header regression |

## First 30 minutes

1. **Declare** — assign an incident lead; open a timestamped log; set severity.
2. **Contain**
   - Leaked credential/secret → rotate now: `wrangler secret put …`, then
     `revokeAllSessions` for affected users (or truncate `sessions`).
   - Auth bypass / isolation bug → roll back the Worker
     (`docs/runbooks/rollback.md`); if unclear, deploy a build with the
     affected route disabled.
   - Compromised account → `users.status='disabled'` (kills sessions next
     request), revoke its sessions, remove its memberships.
3. **Preserve evidence** — snapshot `audit_log` and recent Logpush for the
   window; note the current D1 Time Travel bookmark before any restore.

## Investigate

- Reconstruct from `audit_log` (action, user, club, entity, timestamp) and
  structured request logs (`requestId`, `userId`, `clubId`, route, status).
- Determine: what data, which clubs/subjects, how many, exact time window,
  root cause.
- Cross-tenant check: `PRAGMA foreign_key_check;` and per-`club_id` row counts
  for anomalies.

## Recover

- Restore data per `docs/runbooks/database-restore.md` if integrity was lost.
- Deploy the fix with a new regression test proving the hole is closed
  (add to `cloudflare/test/` isolation suite).
- Verify with the deployment post-deploy checklist plus a targeted repro of the
  original issue.

## Notify

- SEV-1 personal-data exposure: assess GDPR Art. 33 (supervisory authority,
  ≤ 72 h) and Art. 34 (affected individuals). The DFBnet context means minors
  may be involved — treat as high risk.
- Notify affected club owners with: what happened, data involved, time window,
  remediation, what they should do.

## Post-incident (within 5 working days)

Blameless write-up: timeline, root cause, impact, what worked, what didn't,
action items with owners and dates. File under `docs/incidents/`. Fold
durable lessons into the threat model and the readiness checklist.
