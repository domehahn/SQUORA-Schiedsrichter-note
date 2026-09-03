# CODEX EPIC — implementation status

Audit of the 47-epic production-readiness brief against `main` at commit
`96112ef`. Legend: **done** shipped and tested · **partial** core in place,
gaps noted · **open** not started.

| Epic | Status | Evidence / gap |
| --- | --- | --- |
| 0 — Security cleanup & baseline | done | Synthetic fixtures ("Max Testspieler", `0100-0000`, `@example.invalid`); `docs/security/{THREAT_MODEL,TENANT_ISOLATION,DATA_CLASSIFICATION,SECURITY_ASSUMPTIONS}.md`; CI secret guard. |
| 1 — Cloudflare D1 | done | `migrations/0001…0013`; `wrangler.jsonc` D1 binding per env; `applyD1Migrations` in worker tests. |
| 2 — Data model | done | `users, clubs, memberships, teams, players, matches, match_events, tournaments, dfbnet_imports, sessions, audit_log` + `team_*` sync tables. UUID ids, `version` columns. |
| 3 — Server tenant resolution | done | `middleware/tenant.ts` `requireTenantAccess` / `requireTeamAccess`; no club query runs before a `TenantContext`. |
| 4 — RBAC | done | `auth/roles.ts`, `auth/permissions.ts` (5 roles, 17 permissions); every API passes an explicit permission. |
| 5 — Auth & sessions | partial | D1 users + hashed, revocable sessions (`auth/session.ts`), logout / logout-all, 8h expiry, disabled-account check. `AUTH_USERS` bootstrap secret still the account source; no self-serve invite/registration. |
| 6 — Origin isolation | done | `wrangler.jsonc` route `schiri.squora.de`; worker keeps the `/schiedsrichter-note` prefix only as a legacy redirect; cookie `Path=/`. |
| 7 — Local storage security | done | `encryptedCache.ts` (IndexedDB, AES-GCM record); `localData.ts` legacy keys read-only via migration flow. |
| 8 — Cryptography | done | PBKDF2-SHA256 600k iters, 128-bit salt, AES-256-GCM, 96-bit IV; passphrase floor 12, no max; key non-extractable, memory only. |
| 9 — E2E vs SaaS encryption decision | done | `docs/architecture/ADR-001-encryption-model.md` — Model C hybrid. |
| 10 — DFBnet integration layer | partial | `src/integrations/dfbnet/{parser,schema,mapper,validator,fingerprint,provider,types}.ts` — RFC-4180 parser, limits, schema detection, dedup. No server-side staged import endpoint (`POST /api/v1/clubs/:id/dfbnet/imports`); import is client-only today. |
| 11 — DFBnet data minimization | done | `ALLOWED` whitelist in `schema.ts`; server `FORBIDDEN_DFBNET_FIELDS` strips birthdate/pass/nationality/eligibility in `api/state.ts`. |
| 12 — DFBnet adapter architecture | done | `RosterProvider` interface + `DfbnetCsvProvider`; domain model has no DFBnet field names. |
| 13 — API architecture | partial | `cloudflare/{api,auth,middleware,core,services,legacy}` split. No `repositories/` layer; `members/players/tournaments/dfbnet/audit` API modules not yet present. |
| 14 — API versioning | done | All routes under `/api/v1/`. |
| 15 — BOLA / IDOR | done | `cloudflare/test/{tenant,matches,teams}.test.ts` — foreign club/match/team → 404; foreign update/delete → 404. |
| 16 — Database integrity | done | Composite PKs `(club_id, id)`, composite FKs `(club_id, team_id) → teams`, `CHECK`, `UNIQUE (club_id, external_id)`. |
| 17 — Optimistic locking | done | `version` on `matches/tournaments/teams`; `team_sync_versions` aggregate; 409 `VERSION_CONFLICT`; rollback on batch failure. |
| 18 — Audit logging | partial | `services/audit-service.ts` + `audit_log`; writes for CLUB/TEAM/MATCH create/update/delete. `LOGIN_*`, `LOGOUT`, `MEMBER_*`, `DFBNET_*`, `EXPORT_CREATED` not yet emitted. |
| 19 — Observability | done | `recordRequest` structured line (requestId, userId, clubId, route, status, durationMs); `X-Request-Id` header; `wrangler.jsonc` observability on. |
| 20 — Error handling | done | `HttpError` → `{ error: { code, message }, requestId }`; internal detail only via `console.error`. |
| 21 — Backup & recovery | partial | `docs/runbooks/database-restore.md` written (Time Travel, RPO/RTO). Restore not yet rehearsed against staging. |
| 22 — Data retention & GDPR | partial | `docs/privacy/{DATA_RETENTION,DATA_DELETION,DATA_EXPORT,DFBNET_DATA_HANDLING}.md` written. Delete/export endpoints not yet implemented. |
| 23 — CI/CD | done | `.github/workflows/ci.yml` — quality, e2e, security (npm audit, secret grep), CodeQL. |
| 24 — E2E against real Worker | open | Playwright runs against Vite with a mocked `/api/**`. No Wrangler/Miniflare browser suite. |
| 25 — Security test suite | partial | Cross-tenant/BOLA/RBAC/concurrency covered in `cloudflare/test/*`. No dedicated `tests/security/` directory with `csrf/session/import/export` specs. |
| 26 — Environments | done | `wrangler.jsonc` `env.development` / `env.staging` / top-level production, separate D1 + rate-limiter namespaces. |
| 27 — Deployment safety | partial | `docs/operations/DEPLOYMENT.md` + `docs/runbooks/rollback.md` (build-once, Cloudflare Versions, rollback). Gradual deployments not configured. |
| 28 — Rate limiting | partial | `LOGIN_RATE_LIMITER` binding (10/60s prod). Not yet applied to import/export/reporting; no IP+account+tenant composite key. |
| 29 — Security headers | done | `SECURITY_HEADERS` + CSP without `unsafe-inline` (`script-src 'self'`), HSTS, COOP/COEP/CORP, Permissions-Policy, `frame-ancestors 'none'`. |
| 30 — Service worker security | done | Vite PWA `NetworkOnly` for `/api/*` and `/auth/*`; no domain data cached. Automated assertion still to add. |
| 31 — Import / export hardening | partial | `core/validation.ts` strict validators, bounded `readJson`, `boundedJson`. No shared schema layer (Zod-equivalent) across all endpoints. |
| 32 — Repository architecture | partial | Worker split into layers. `src/App.tsx` remains large. |
| 33 — Legacy KV migration | partial | `legacy/kv-migration.ts` read-only compat source; `fetchLegacy` + gate opt-in migration into a team. No authenticated `POST /migrations` endpoint with fingerprint/verification/marker. |
| 34 — Tenant-model migration | partial | Legacy blob maps into a chosen club+team on first unlock. No stored `legacyTenantId → club.id` table. |
| 35 — Repository security | done | CI secret guard; no secrets tracked; fixtures synthetic. |
| 36 — Dependency security | done | `npm audit` clean; `npm audit --audit-level=high` in CI. |
| 37 — Production documentation | partial | `architecture/`, `security/`, `privacy/`, `operations/`, `runbooks/` populated. `INCIDENT_RESPONSE.md` added. Some cross-links pending. |
| 38 — Threat model | done | `docs/security/THREAT_MODEL.md` covers the listed threat classes. |
| 39 — CSV injection | done | `src/csv.ts` prefixes `= + - @ \t \r` cells with `'`; used by both export paths. |
| 40 — API input validation | done | `core/validation.ts` — bounded strings, UUID format checks, event/array caps. |
| 41 — Pagination | partial | `listMatches` is cursor-paginated (limit ≤ 100). `audit/players/imports/members` lists not yet built. |
| 42 — Soft vs hard delete | partial | `matches`/`tournaments` soft-delete (`deleted_at`). Club/user/import policy documented in `DATA_DELETION.md`, not enforced in code. |
| 43 — Account lifecycle | partial | `users.status` + disabled-session check. `invited` state unused (no invite flow). |
| 44 — Membership lifecycle | partial | `memberships.status='active'` required everywhere; removing a row / setting non-active revokes immediately. `suspended`/`invited` transitions have no API. |
| 45 — Tenant switching | done | `listClubs` / `listTeams` return only `status='active'` memberships; client cache is UI-only, never an authz input. |
| 46 — Privacy by design | done | `DATA_CLASSIFICATION.md` review checklist; minors covered in `DFBNET_DATA_HANDLING.md`. |
| 47 — Production readiness gate | partial | `docs/PRODUCTION_READINESS.md` checklist written; several items still RED (see the doc). |

## Not ready for production

The blocking gaps before a `READY` verdict (see `docs/PRODUCTION_READINESS.md`):

1. `wrangler.jsonc` carries placeholder D1 `database_id`s — real databases must
   be created and migration `0013` applied.
2. No real-Worker E2E suite (Epic 24) and no `tests/security/` gate (Epic 25).
3. Restore (Epic 21) and rollback (Epic 27) are documented but not rehearsed.
4. Data export / deletion endpoints (Epic 22) are specified but not implemented.
5. Auth still bootstraps from `AUTH_USERS`; no invite/registration/MFA (Epics 5, P2).
