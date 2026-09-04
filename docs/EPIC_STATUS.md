# CODEX EPIC — implementation status

Audit of the 47-epic production-readiness brief against `main` at commit
`9742ec8`. Legend: **done** shipped and tested · **partial** core in place,
gaps noted · **open** not started.

| Epic | Status | Evidence / gap |
| --- | --- | --- |
| 0 — Security cleanup & baseline | done | Synthetic fixtures ("Max Testspieler", `0100-0000`, `@example.invalid`); `docs/security/{THREAT_MODEL,TENANT_ISOLATION,DATA_CLASSIFICATION,SECURITY_ASSUMPTIONS}.md`; CI secret guard. |
| 1 — Cloudflare D1 | done | `migrations/0001…0015`; `wrangler.jsonc` D1 binding per env; `applyD1Migrations` in worker tests; all migrations applied remotely in dev/staging/production. |
| 2 — Data model | done | `users, clubs, memberships, teams, players, matches, match_events, tournaments, dfbnet_imports, sessions, audit_log` + `team_*` sync tables. UUID ids, `version` columns. |
| 3 — Server tenant resolution | done | `middleware/tenant.ts` `requireTenantAccess` / `requireTeamAccess`; no club query runs before a `TenantContext`. |
| 4 — RBAC | done | `auth/roles.ts`, `auth/permissions.ts` (5 roles, 17 permissions); every API passes an explicit permission. |
| 5 — Auth & sessions | done | D1 users + PBKDF2-SHA256 600k hashes, revocable hashed sessions (`auth/session.ts`), logout / logout-all, 8h expiry, disabled-account check. Production account lives only in D1; no runtime credential secret. |
| 6 — Origin isolation | partial | Product decision: production stays at `squora.de/schiedsrichter-note/` (not a dedicated origin). Worker strips the `/schiedsrichter-note` prefix on the way in and prefixes every URL it emits; cookie `Path=/`; SW `NetworkOnly` matches `/api/` `/auth/` at any depth. Full origin isolation (own subdomain) deferred. |
| 7 — Local storage security | done | `encryptedCache.ts` (IndexedDB, AES-GCM record); `localData.ts` legacy keys read-only via migration flow. |
| 8 — Cryptography | done | PBKDF2-SHA256 600k iters, 128-bit salt, AES-256-GCM, 96-bit IV; passphrase floor 12, no max; key non-extractable, memory only. |
| 9 — E2E vs SaaS encryption decision | done | `docs/architecture/ADR-001-encryption-model.md` — Model C hybrid. |
| 10 — DFBnet integration layer | done | Client `src/integrations/dfbnet/*` (RFC-4180 parser, limits, schema detection, dedup) plus server-side staged endpoint `POST/GET /api/v1/clubs/:c/teams/:t/dfbnet/imports` and `…/:id/confirm` in `cloudflare/api/dfbnet.ts` — re-validate, re-minimize, server-computed fingerprint, `dfbnet_imports` audit record, idempotent player upsert. |
| 11 — DFBnet data minimization | done | `ALLOWED` whitelist in `schema.ts`; server `FORBIDDEN_DFBNET_FIELDS` strips birthdate/pass/nationality/eligibility in `api/state.ts`. |
| 12 — DFBnet adapter architecture | done | `RosterProvider` interface + `DfbnetCsvProvider`; domain model has no DFBnet field names. |
| 13 — API architecture | partial | `cloudflare/{api,auth,middleware,core,services,legacy}` split with dedicated members, DFBnet and migration modules. No separate `repositories/` layer; the client `App.tsx` remains large. |
| 14 — API versioning | done | All routes under `/api/v1/`. |
| 15 — BOLA / IDOR | done | `cloudflare/test/{tenant,matches,teams}.test.ts` — foreign club/match/team → 404; foreign update/delete → 404. |
| 16 — Database integrity | done | Composite PKs `(club_id, id)`, composite FKs `(club_id, team_id) → teams`, `CHECK`, `UNIQUE (club_id, external_id)`. |
| 17 — Optimistic locking | done | `version` on `matches/tournaments/teams`; `team_sync_versions` aggregate; 409 `VERSION_CONFLICT`; rollback on batch failure. |
| 18 — Audit logging | done | Emitted and tested: auth/session, club/team/state/match, DFBnet, legacy migration, membership invite/role/status/removal, export and deletion actions. |
| 19 — Observability | done | `recordRequest` structured line (requestId, userId, clubId, route, status, durationMs); `X-Request-Id` header; `wrangler.jsonc` observability on. |
| 20 — Error handling | done | `HttpError` → `{ error: { code, message }, requestId }`; internal detail only via `console.error`. |
| 21 — Backup & recovery | done | Time Travel + export runbook; staged marker/restore rehearsal completed 2026-09-04 in under 2 minutes with all migrations intact. |
| 22 — Data retention & GDPR | partial | `docs/privacy/*` written. `GET /clubs/:id/export`, `DELETE /clubs/:id` (owner + name-confirm, cascade), `DELETE /api/v1/me` (tombstone + session revoke + solely-owned-club purge) implemented and tested. Retention *jobs* (rolling cleanup, 30-day club grace) still policy-only. |
| 23 — CI/CD | done | `.github/workflows/ci.yml` — quality, e2e, security (npm audit, secret grep), CodeQL. |
| 24 — E2E against real Worker | done | `tests/worker/` Playwright suite runs against `wrangler dev --local` + local D1 (`playwright.worker.config.ts`, global-setup seeds a throwaway DB). CI job `e2e-worker`. Covers login, `/me`, session survival + logout, cross-tenant 404. |
| 25 — Security test suite | done | `cloudflare/test/security/{csrf,session,bola,rbac,concurrency,rate-limit}.test.ts` run in the `test:worker` merge gate. |
| 26 — Environments | done | `wrangler.jsonc` `env.development` (`routes:[]`) / `env.staging` / top-level production, separate D1 + three rate-limiter namespaces each. |
| 27 — Deployment safety | done | Deployment and rollback runbooks; staging rollback and roll-forward rehearsal completed 2026-09-04. |
| 28 — Rate limiting | done | `LOGIN` (10/60s), `EXPORT` (5/60s), `IMPORT` (20/60s) limiters; `core/rate-limit.ts` folds IP + account + tenant + endpoint into one composite key. `rate-limit.test.ts` proves export throttling. |
| 29 — Security headers | done | `SECURITY_HEADERS` + CSP without `unsafe-inline` (`script-src 'self'`), HSTS, COOP/COEP/CORP, Permissions-Policy, `frame-ancestors 'none'`. |
| 30 — Service worker security | done | Vite PWA `NetworkOnly` for `/api/*` and `/auth/*`; `verify-service-worker.mjs` asserts generated output and runs in CI. |
| 31 — Import / export hardening | partial | `core/validation.ts` strict validators, bounded `readJson`, `boundedJson`. No shared schema layer (Zod-equivalent) across all endpoints. |
| 32 — Repository architecture | partial | Worker split into layers. `src/App.tsx` remains large. |
| 33 — Legacy KV migration | done | Explicit opt-in UI plus authenticated list/read/migrate API; source fingerprint verification, idempotency, D1 marker and audits; source remains intact. |
| 34 — Tenant-model migration | done | `legacy_migrations` stores verified `user + legacyTenantId → club + team`; foreign targets and remapping are rejected and tested. |
| 35 — Repository security | done | CI secret guard; no secrets tracked; fixtures synthetic. |
| 36 — Dependency security | done | `npm audit` clean; `npm audit --audit-level=high` in CI. |
| 37 — Production documentation | partial | `architecture/`, `security/`, `privacy/`, `operations/`, `runbooks/` populated. `INCIDENT_RESPONSE.md` added. Some cross-links pending. |
| 38 — Threat model | done | `docs/security/THREAT_MODEL.md` covers the listed threat classes. |
| 39 — CSV injection | done | `src/csv.ts` prefixes `= + - @ \t \r` cells with `'`; used by both export paths. |
| 40 — API input validation | done | `core/validation.ts` — bounded strings, UUID format checks, event/array caps. |
| 41 — Pagination | partial | `listMatches` and `listMembers` cursor-paginated; `listDfbnetImports` limit-capped (≤ 100). A public audit-list endpoint is intentionally not exposed. |
| 42 — Soft vs hard delete | partial | `matches`/`tournaments` soft-delete (`deleted_at`). Club = hard delete + cascade (`purgeClub`); user = tombstone (soft). Documented in `DATA_DELETION.md`. |
| 43 — Account lifecycle | partial | `users.status` + disabled-session check; invite creates a non-login-capable invited account. Secure invite acceptance / password setup remains a follow-up. |
| 44 — Membership lifecycle | done | Audited invite, role/team/status changes and removal API; `active` is required everywhere, revocation is immediate, last-owner invariant tested. |
| 45 — Tenant switching | done | `listClubs` / `listTeams` return only `status='active'` memberships; client cache is UI-only, never an authz input. |
| 46 — Privacy by design | done | `DATA_CLASSIFICATION.md` review checklist; minors covered in `DFBNET_DATA_HANDLING.md`. |
| 47 — Production readiness gate | partial | All code, isolation, recovery and rollback gates are green. External alert-channel wiring remains operational follow-up (see `docs/PRODUCTION_READINESS.md`). |

## Remaining production follow-ups

No RED implementation gate remains. Operational follow-ups are automated
retention/weekly off-platform export jobs, an external alert channel for
5xx/auth/import failures, and secure invite acceptance/password setup. Dedicated
origin isolation remains deferred by the documented product decision to retain
`squora.de/schiedsrichter-note/`.
