# Production readiness gate

A release is **READY** only when every item below is GREEN with evidence
(a passing CI run, a test file, a rehearsal log entry). Any RED item blocks
production deployment.

Status as of commit `74f6df6` — 2026-09-04.

| # | Criterion | State | Evidence / what's missing |
| --- | --- | --- | --- |
| 1 | CI green on `main` | 🟢 | `.github/workflows/ci.yml`: quality + e2e + e2e-worker + security + CodeQL |
| 2 | No secrets in the repo or history | 🟢 | CI secret guard; `docs/security` review; fixtures synthetic |
| 3 | No real test PII | 🟢 | "Max Testspieler", `0100-0001`, `@example.invalid` / `@e2e.invalid` throughout |
| 4 | Tenant-isolation tests as merge gate | 🟢 | `cloudflare/test/{tenant,matches,teams}.test.ts` + `security/bola.test.ts` — foreign club/team/match/export/import → 404; `test:worker` CI job |
| 5 | RBAC tested | 🟢 | `security/rbac.test.ts`: viewer read-only, referee cannot delete/manage/import/export, only owner deletes club |
| 6 | Optimistic locking, no silent last-write-wins | 🟢 | `version` columns + `team_sync_versions`; `security/concurrency.test.ts` |
| 7 | D1 migrations tested + applied | 🟢 | `applyD1Migrations` covers `0001–0014`; applied to real EU D1 (dev/staging/production), 17→18 tables verified |
| 8 | Separate dev / staging / production | 🟢 | `wrangler.jsonc` env split; three real EU D1 databases; per-env rate-limiter namespaces; `env.development` pins `routes:[]` |
| 9 | Encrypted local storage; keys memory-only | 🟢 | `encryptedCache.ts`; PBKDF2 600k / AES-256-GCM; no key in `localStorage`/logs |
| 10 | CSP without `unsafe-inline`, HSTS, frame protection | 🟢 | `core/http.ts` `SECURITY_HEADERS` + CSP |
| 11 | Service worker never caches `/api/*` `/auth/*` | 🟡 | Vite PWA `NetworkOnly` configured; automated assertion still to add (Epic 30) |
| 12 | DFBnet import validated / minimized | 🟢 | client parser + limits + whitelist + server re-minimize + staged endpoint `cloudflare/api/dfbnet.ts` + `dfbnet_imports` audit; `dfbnet.test.ts` |
| 13 | Structured logs with `requestId`, no PII | 🟢 | `recordRequest`; `X-Request-Id` header |
| 14 | Audit log for security-relevant actions | 🟡 | LOGIN_*/LOGOUT, CLUB_CREATED/DELETED, TEAM_CREATED, TEAM_STATE_SYNCED, MATCH_*, DFBNET_IMPORT_*, EXPORT_CREATED, USER_DELETED emitted. MEMBER_* pending the membership API (Epic 13) |
| 15 | Backup + restore rehearsed against staging | 🔴 | `docs/runbooks/database-restore.md` written; rehearsal not performed |
| 16 | Rollback rehearsed | 🔴 | `docs/runbooks/rollback.md` written; not exercised |
| 17 | Data export + deletion flows | 🟢 | `GET /clubs/:id/export`, `DELETE /clubs/:id` (cascade), `DELETE /api/v1/me` (tombstone) + `lifecycle.test.ts` (8 cases) |
| 18 | Real-Worker E2E (browser → Worker → D1) | 🟢 | `tests/worker/` against `wrangler dev --local` + local D1; CI job `e2e-worker` |
| 19 | Dedicated security suite | 🟢 | `cloudflare/test/security/{csrf,session,bola,rbac,concurrency,rate-limit}.test.ts` in the `test:worker` gate |
| 20 | Rate limiting beyond login | 🟢 | `EXPORT_RATE_LIMITER` (5/60s), `IMPORT_RATE_LIMITER` (20/60s); `core/rate-limit.ts` composite IP+account+tenant+endpoint key; `rate-limit.test.ts` |
| 21 | Legacy KV → D1 migration endpoint (idempotent, auditable) | 🔴 | read-only compat only; no authenticated migration endpoint (Epics 33–34) |
| 22 | Observability operational (dashboards / alerts) | 🟡 | `wrangler.jsonc` observability on; no alerting wired |
| 23 | Incident response documented | 🟢 | `docs/runbooks/incident-response.md` |

Legend: 🟢 done · 🟡 partial · 🔴 not started.

## Verdict

**NOT READY.** Blocking (🔴): items 15, 16, 21. Must-fix-before-launch (🟡):
items 11, 14, 22.

## Minimum path to READY

1. Rehearse restore and rollback against staging; record RTO (items 15, 16).
2. Build the authenticated, idempotent legacy KV→D1 migration endpoint with a
   `legacyTenantId → club.id` mapping and verification marker (item 21).
3. Add a service-worker cache assertion (item 11).
4. Wire at least one alert (error-rate / 5xx spike) to a channel (item 22).
5. Build the membership API and emit `MEMBER_INVITED/ROLE_CHANGED/REMOVED`
   (item 14; also unblocks Epics 43–44).
