# Current architecture

Status: 2026-09-04, commit `521e083`. Per-epic detail: `docs/EPIC_STATUS.md`;
release gate: `docs/PRODUCTION_READINESS.md`.

## Runtime

React 19 / Vite PWA served by a single Cloudflare Worker
(`cloudflare/worker.ts`). The Worker serves the static build (`ASSETS`,
`run_worker_first`), renders the login form and exposes the `/api/v1` REST API.
Production is served at `squora.de/schiedsrichter-note/` (product decision — no
dedicated origin). The Worker strips the `/schiedsrichter-note` prefix
(`MOUNT_PATH`) from every incoming path and prefixes every URL it emits. Vite
PWA precaches static assets and forces `NetworkOnly` for `/api/` and `/auth/` at
any path depth (`scripts/verify-service-worker.mjs` asserts this in CI).

A `scheduled` handler runs daily (`triggers.crons`): retention cleanup
(`services/retention.ts`) and a threshold alert self-check (`services/alerting.ts`).

## Authentication & sessions

- D1 `users` is authoritative; the production account exists only in D1 (no
  runtime credential secret). Passwords are PBKDF2-SHA256, 600 000 iterations.
- Login → a random 256-bit session token; only `SHA-256(token)` is stored in
  `sessions`. Cookie `HttpOnly; Secure; SameSite=Strict`, 8 h expiry.
- Sessions are individually and bulk revocable. `optionalAuth` re-checks
  `users.status='active'` and `revoked_at IS NULL AND expires_at > now` on every
  request — disabling an account or revoking a session takes effect immediately.
- Membership lifecycle API (invite / role / team / status / removal) with
  `MEMBER_*` audit; `active` is required everywhere; last-owner invariant.

## Tenant & authorization model

- D1 is authoritative: `users → memberships (role, status, team_id?) → clubs →
  teams → matches/match_events/tournaments/players/dfbnet_imports/audit_log`,
  plus `team_sync_versions`/`team_drafts`/`team_rosters` and `legacy_migrations`.
- `middleware/tenant.ts` produces a `TenantContext` (`requireTenantAccess`) or
  `TeamContext` (`requireTeamAccess`) — active session → active membership →
  role permission — before any club/team query. `denyTeamScoped()` hides the
  club-wide match/export endpoints from a team-scoped membership.
- URL / body identifiers are untrusted selectors; foreign or missing resources
  return 404, never 403/500.
- Composite primary and foreign keys (`(club_id, id)`, `(club_id, team_id) →
  teams`) make cross-tenant rows impossible at the DB level.
- RBAC: 5 roles, 17 permissions (`auth/roles.ts` / `auth/permissions.ts`;
  `docs/architecture/RBAC.md`).

## Data & synchronization

- The team (Jugend) is the isolation unit inside a club. Each `(club, team)` has
  its own `team_sync_versions` (aggregate optimistic-lock counter),
  `team_drafts` (live match + clock) and `team_rosters` (minimized roster
  library).
- `GET/PUT /api/v1/clubs/:club/teams/:team/state` is the whole-team snapshot
  (archive, tournaments, roster library, live match). PUT is optimistically
  locked: the version bump **and** the data write run in one `DB.batch()`
  transaction with an abort-guard, so it is atomic under truly parallel writers;
  a mismatch is 409 `VERSION_CONFLICT`. The write is **incremental** — unchanged
  matches (and their events) and tournaments are skipped; only changed/new rows
  are upserted and only removed rows are deleted.
- Individual match CRUD (`/matches`, `/matches/:id`) requires a `teamId` of the
  club, is cursor-paginated, soft-deletes (`deleted_at`), per-row `version` in
  one atomic batch, and writes `audit_log`.
- Bodies with a small fixed shape are validated by `core/validation.ts`
  `parseBody(value, spec)` which rejects undeclared fields (422 `UNKNOWN_FIELD`).
- `FORBIDDEN_DFBNET_FIELDS` strips birthdate/pass/nationality/eligibility from
  every synced payload server-side.

## Lifecycle & retention

- Club deletion is a 30-day grace window: `DELETE /clubs/:id` sets
  `status='deleted'` + `deletion_due_at` (invisible to every tenant query at
  once, data retained); `POST /clubs/:id/deletion/cancel` restores it; the daily
  cron `runClubPurge` cascades via `purgeClub` once due (`CLUB_DELETED`).
- Account deletion tombstones the `users` row, removes memberships, revokes
  sessions, purges the departing owner's solely-owned clubs immediately.
- `GET /clubs/:id/export` returns the full club tree (`club.manage`,
  rate-limited, `EXPORT_CREATED`).
- Daily retention: expired/revoked sessions purged; `audit_log` trimmed at 24
  months, `dfbnet_imports` at 12.

## Client storage & crypto

- One encrypted snapshot per `(userId, club, team)` in IndexedDB
  (`encryptedCache.ts`), AES-256-GCM, key derived with PBKDF2-HMAC-SHA256
  (600 000 iterations, 128-bit salt), non-extractable, memory only. The gate
  asks for a passphrase **only** when an encrypted cache already exists on the
  device; online-only users never see it.
- Club/team selection is driven purely by memberships (0 → onboarding, 1 →
  auto, n → own-clubs list). The passphrase is never a club gate.
- `localStorage` holds only non-sensitive UI state; legacy plaintext keys are
  read once by the migration flow.
- Encryption model: `docs/architecture/ADR-001-encryption-model.md` (Model B in
  effect for server data; Model C for the offline cache; note E2E is a target).

## DFBnet import

Client `src/integrations/dfbnet/` (RFC-4180 parser, `DFBNET_LIMITS`, schema
detection, mapper, fingerprint, `RosterProvider`/`DfbnetCsvProvider`). Server:
staged endpoint `POST/GET /api/v1/clubs/:c/teams/:t/dfbnet/imports` and
`…/:id/confirm` — re-validate, re-minimize, server-computed team-scoped
fingerprint, `dfbnet_imports` record, `DFBNET_IMPORT_*` audit, idempotent player
upsert with `mode: merge | replace` (replace reconciles the roster). Rate-limited
(`IMPORT_RATE_LIMITER`). Original CSV never stored or logged.

## Security headers & error shape

`SECURITY_HEADERS` + a CSP with `script-src 'self'` (no `unsafe-inline`), HSTS,
COOP/COEP/CORP, `frame-ancestors 'none'`, Permissions-Policy. Errors are
`{ error: { code, message }, requestId }`; internal detail only via
`console.error`. Every response carries `X-Request-Id`; every request logs a
structured line.

## Quality baseline

- Unit: 33 · Worker (Miniflare + D1 `0001–0016`): 64 · e2e (Playwright): 19
  (+1 skipped) · real-Worker e2e: 3 · build + lint + `npm audit --audit-level=high`:
  clean.
- CI: `.github/workflows/ci.yml` (quality, e2e, e2e-worker, security, CodeQL).
  `main` branch protection requires all 5 checks.

## Known gaps

Tracked in `docs/EPIC_STATUS.md` / `docs/PRODUCTION_READINESS.md`: the DFBnet
**UI** still keeps opponent rosters in the match blob rather than
`teams`/`players` (needs the relational roster model); no incremental relational
match/event API yet (the `/state` snapshot is the sync surface); season-based
match cleanup and the weekly logical `d1 export` are policy-only;
`ALERT_WEBHOOK_URL` must be set in production for alerts to deliver; no
`repositories/` layer.
