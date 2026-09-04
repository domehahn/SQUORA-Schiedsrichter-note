# Current architecture

Status: 2026-09-04, commit `5b6ecc0`. Per-epic detail: `docs/EPIC_STATUS.md`;
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
  runtime credential secret). Passwords are hashed with PBKDF2-SHA256 in a
  versioned format. Preferred: one 600 000-iteration `node:crypto` call
  (`pbkdf2-sha256$i=600000$<salt>$<hash>`), used when a per-isolate probe finds
  it available. Fallback: 6 chained WebCrypto rounds of 100 000
  (`pbkdf2-sha256$100000*6$…`) — `crypto.subtle` rejects a single call above
  100 000. `verifyPassword` reports `needsRehash`; login upgrades legacy hashes.
- Login → a random 256-bit session token; only `SHA-256(token)` is stored in
  `sessions`. Cookie `HttpOnly; Secure; SameSite=Strict`, 8 h expiry.
- Sessions are individually and bulk revocable. `optionalAuth` re-checks
  `users.status='active'` and `revoked_at IS NULL AND expires_at > now` on every
  request — disabling an account or revoking a session takes effect immediately.
- Membership lifecycle API (role / team / status / removal) with `MEMBER_*`
  audit; `active` is required everywhere; last-owner invariant.
- Joining is via a **token invitation** (`api/invitations.ts`, table
  `invitations`): 256-bit token, `SHA-256` at rest, 7-day expiry, one-time,
  generic 404. `POST /auth/register` (public, token-gated — e-mail comes from
  the invitation) creates the account + active membership in one batch; an
  existing signed-in user accepts via `POST /invitations/accept` and the
  e-mail must match. No existing account is ever silently added to a club.

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
- `GET/PUT /api/v1/clubs/:club/teams/:team/state`. GET returns the whole-team
  snapshot. PUT takes either a **delta** (`{ delta: true, matches: { upsert,
  removeIds }, tournaments: {…}, teams?, current? }` — only the listed rows are
  touched, the normal client sync after first load) or a **full snapshot**
  (server diffs it and additionally sweeps rows the client dropped — bootstrap /
  legacy migration / reconciliation). Both are optimistically locked: the
  version bump **and** every data statement run in one `DB.batch()` transaction
  with an abort-guard, atomic under truly parallel writers; mismatch → 409
  `VERSION_CONFLICT`. The client (`sync.ts`) keeps the last confirmed snapshot
  per scope and computes the delta from it.
- Individual match CRUD (`/matches`, `/matches/:id`) requires a `teamId` of the
  club, is cursor-paginated, soft-deletes (`deleted_at`), per-row `version` in
  one atomic batch, and writes `audit_log`.
- Bodies with a small fixed shape are validated by `core/validation.ts`
  `parseBody(value, spec)` which rejects undeclared fields (422 `UNKNOWN_FIELD`).
- DFBnet minimisation runs two server-enforced whitelists (`core/dfbnet.ts`):
  the own-team relational roster (`players`) keeps `passNumber` + `birthdate`
  for the referee passport / eligibility check; the `/state` sync blob keeps
  `pass` but strips `birthdate`. `nationality`/`eligibility`/`registrationDate`
  are stripped from every synced payload at every depth
  (`docs/privacy/DFBNET_DATA_HANDLING.md`).

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
  months, `dfbnet_imports` at 12; stale `pending` invitations flipped to
  `expired`, terminal invitations dropped after 90 days.
- `purgeClub` hard-deletes every club-scoped table — matches, events,
  tournaments, players, team_* blobs, `legacy_migrations`, teams,
  `dfbnet_imports`, `invitations`, memberships — then the `clubs` row
  (`lifecycle.test.ts` asserts no orphans).

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
(`IMPORT_RATE_LIMITER`). Original CSV never stored or logged. The "Mein Kader"
panel drives this endpoint for the referee's own team; `players` also has
`GET/POST/PATCH/DELETE` CRUD plus `DELETE …/players` to clear the whole roster (`api/players.ts`, team-scoped, optimistic-locked, `PLAYER_*` audit).

## Public live ticker

Opt-in, per-team: `POST/DELETE /api/v1/clubs/:c/teams/:t/draft/share`
(authenticated, `matches.update`) mints/rotates or clears a 256-bit token —
only `SHA-256(token)` is stored, on the team's `team_drafts` row (migration
0020). `GET /api/v1/live/:token` and the static page `/live/:token`
(`cloudflare/worker.ts` `livePage` + `public/live.{js,css}`, same CSP,
`script-src 'self'`) are the only unauthenticated, public surface in the app.
The response is server-derived, never the stored free text: score (counted
from event kinds), phase, and a generic event log (`Tor`, `Gelbe Karte`, …) —
**never** player names, pass numbers, birthdates, or the referee's own
labels/notes. Rate-limited (`LOGIN_RATE_LIMITER`). The share is tied to the
live draft, so it disappears automatically once the match is archived (the
`team_drafts` row is deleted) or explicitly revoked; nothing is ever persisted
beyond the running match. QR code is rendered client-side
(`qrcode-generator`, bundled, no third-party network call) from the link only.

## Security headers & error shape

`SECURITY_HEADERS` + a CSP with `script-src 'self'` (no `unsafe-inline`), HSTS,
COOP/COEP/CORP, `frame-ancestors 'none'`, Permissions-Policy. Errors are
`{ error: { code, message }, requestId }`; internal detail only via
`console.error`. Every response carries `X-Request-Id`; every request logs a
structured line.

## Quality baseline

- Unit: 43 · Worker (Miniflare + D1 `0001–0020`): 96 · e2e (Playwright): 21
  (+1 skipped) · real-Worker e2e: 5 · build + lint + `npm audit --audit-level=high`:
  clean.
- CI: `.github/workflows/ci.yml` (quality, e2e, e2e-worker, security, CodeQL;
  plus a gated `staging-e2e` remote smoke). `security` runs `npm audit
  --audit-level=high` (hard fail), gitleaks full history and a PII-history
  guard. `main` branch protection requires the 5 core checks —
  `docs/operations/branch-protection.md`.

## Known gaps

Tracked in `docs/EPIC_STATUS.md` / `docs/PRODUCTION_READINESS.md`: opponent and
library rosters deliberately stay in the `/state` sync blob (only the referee's
own team roster is relational — the "Mein Kader" panel + `players` table +
staged `/dfbnet/imports`); no per-resource REST for matches/events beyond the
flat club-wide CRUD (the `/state` delta is the sync surface); the weekly logical
`d1 export` is policy-only; `ALERT_WEBHOOK_URL` must be set in production for
alerts to deliver; no `repositories/` layer.
