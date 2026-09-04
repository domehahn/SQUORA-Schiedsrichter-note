# Current architecture

Status: 2026-09-03, commit `96112ef`. Supersedes the pre-D1 baseline.
Per-epic detail: `docs/EPIC_STATUS.md`.

## Runtime

React 19 / Vite PWA served by a single Cloudflare Worker
(`cloudflare/worker.ts`). The Worker serves the static build (`ASSETS`,
`run_worker_first`), renders the login form, and exposes the `/api/v1` REST API.
Production is served at `squora.de/schiedsrichter-note/` (product decision — no
dedicated origin). The Worker strips the `/schiedsrichter-note` prefix from every
incoming path (`MOUNT_PATH`) and prefixes every URL it emits. Vite PWA precaches
static assets and forces `NetworkOnly` for `/api/*` and `/auth/*` at any depth.

## Authentication & sessions

- Accounts currently come from the `AUTH_USERS` bootstrap secret; D1 `users` is
  the record they resolve to. A self-serve invite/registration flow is not built.
- Login: PBKDF2 password check → a random 256-bit session token; only
  `SHA-256(token)` is stored in `sessions`. Cookie `HttpOnly; Secure;
  SameSite=Strict`, 8 h expiry.
- Sessions are individually and bulk revocable (`/api/v1/auth/logout`,
  `/logout-all`). `optionalAuth` re-checks `users.status='active'` and
  `revoked_at IS NULL AND expires_at > now` on every request, so disabling an
  account or revoking a session takes effect immediately.

## Tenant & authorization model

- D1 is authoritative: `users → memberships (role, status, team_id?) → clubs →
  teams → matches/match_events/tournaments/players/dfbnet_imports/audit_log`.
- `middleware/tenant.ts` produces a `TenantContext` (`requireTenantAccess`) or
  `TeamContext` (`requireTeamAccess`) — active session → active membership →
  role permission — before any club/team query. No handler touches club data
  without one.
- Club id / team id / entity id from the URL or body are untrusted selectors.
  Foreign or missing resources return 404, never 403/500.
- Composite primary and foreign keys (`(club_id, id)`,
  `(club_id, team_id) → teams`) make cross-tenant rows impossible at the DB
  level.
- RBAC: 5 roles, 17 permissions in `auth/roles.ts` / `auth/permissions.ts`
  (`docs/architecture/RBAC.md`).

## Data & synchronization

- The team (Jugend) is the isolation unit inside a club. Each `(club, team)` has
  its own `team_sync_versions` (aggregate optimistic-lock counter), `team_drafts`
  (live match + clock) and `team_rosters` (minimized opponent library).
- `GET/PUT /api/v1/clubs/:club/teams/:team/state` is the whole-team snapshot
  (archive, tournaments, roster library, live match). PUT is guarded by
  `version`; a mismatch is 409 `VERSION_CONFLICT` with rollback of the aggregate
  counter on batch failure.
- Individual match CRUD (`/matches`, `/matches/:id`) is cursor-paginated,
  soft-deletes (`deleted_at`), per-row `version`, and writes `audit_log`.
- `FORBIDDEN_DFBNET_FIELDS` strips birthdate/pass/nationality/eligibility from
  every synced payload server-side (`api/state.ts`).

## Client storage & crypto

- One encrypted snapshot per `(club, team)` in IndexedDB
  (`encryptedCache.ts`), AES-256-GCM, key derived with PBKDF2-HMAC-SHA256
  (600 000 iterations, 128-bit salt), non-extractable, memory only. Passphrase
  ≥ 12 chars, no maximum.
- `localStorage` holds only non-sensitive UI state (active scope key, sound
  toggle) plus legacy keys that are read once by the migration flow.
- Encryption model rationale: `docs/architecture/ADR-001-encryption-model.md`
  (Model C hybrid).

## DFBnet import

`src/integrations/dfbnet/` — `parser` (RFC-4180 state machine), `schema`
(whitelist + `DFBNET_LIMITS`), `validator`, `mapper`, `fingerprint`, `provider`
(`RosterProvider` / `DfbnetCsvProvider`). Import runs client-side into the
caller's authorized team; the original CSV is never stored or logged. A staged
server endpoint with a `dfbnet_imports` audit record is not yet built.

## Security headers & error shape

`SECURITY_HEADERS` + a CSP with `script-src 'self'` (no `unsafe-inline`), HSTS,
COOP/COEP/CORP, `frame-ancestors 'none'`, Permissions-Policy. Errors are
`{ error: { code, message }, requestId }`; internal detail only via
`console.error`. Every response carries `X-Request-Id`; every request logs a
structured line (`requestId`, `userId`, `clubId`, route, status, `durationMs`).

## Quality baseline

- Unit: 33 · Worker (Miniflare + D1 migrations): 17 · e2e (Playwright): 19 (+1
  skipped) · build + lint + `npm audit`: clean.
- CI: `.github/workflows/ci.yml` (quality, e2e, security, CodeQL).

## Known gaps

Tracked in `docs/EPIC_STATUS.md` and `docs/PRODUCTION_READINESS.md`: placeholder
D1 ids, no real-Worker e2e suite, unrehearsed restore/rollback, missing
export/deletion endpoints, audit coverage gaps, rate limiting limited to login,
no legacy KV→D1 migration endpoint.
