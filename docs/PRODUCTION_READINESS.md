# Production readiness gate

A release is **READY** only when every item below is GREEN with evidence
(a passing CI run, a test file, a rehearsal log entry). Any RED item blocks
production deployment.

Status as of commit `9742ec8` — 2026-09-04.

| # | Criterion | State | Evidence / what's missing |
| --- | --- | --- | --- |
| 1 | CI green on `main` | 🟢 | `.github/workflows/ci.yml`: quality + e2e + e2e-worker + security + CodeQL |
| 2 | No secrets in the repo or history | 🟢 | CI secret guard; `docs/security` review; fixtures synthetic |
| 3 | No real test PII | 🟢 | "Max Testspieler", `0100-0001`, `@example.invalid` / `@e2e.invalid` throughout |
| 4 | Tenant-isolation tests as merge gate | 🟢 | `cloudflare/test/{tenant,matches,teams}.test.ts` + `security/bola.test.ts` — foreign club/team/match/export/import → 404; `test:worker` CI job |
| 5 | RBAC tested | 🟢 | `security/rbac.test.ts`: viewer read-only, referee cannot delete/manage/import/export, only owner deletes club |
| 6 | Optimistic locking, no silent last-write-wins | 🟢 | `version` columns + `team_sync_versions`; `security/concurrency.test.ts` |
| 7 | D1 migrations tested + applied | 🟢 | `applyD1Migrations` covers `0001–0015`; applied to real EU D1 (dev/staging/production); remote migration lists report no pending migration |
| 8 | Separate dev / staging / production | 🟢 | `wrangler.jsonc` env split; three real EU D1 databases; per-env rate-limiter namespaces; `env.development` pins `routes:[]` |
| 9 | Encrypted local storage; keys memory-only | 🟢 | `encryptedCache.ts`; PBKDF2 600k / AES-256-GCM; no key in `localStorage`/logs |
| 10 | CSP without `unsafe-inline`, HSTS, frame protection | 🟢 | `core/http.ts` `SECURITY_HEADERS` + CSP |
| 11 | Service worker never caches `/api/*` `/auth/*` | 🟢 | Vite PWA `NetworkOnly`; `scripts/verify-service-worker.mjs` inspects the generated worker and runs in CI |
| 12 | DFBnet import validated / minimized | 🟢 | client parser + limits + whitelist + server re-minimize + staged endpoint `cloudflare/api/dfbnet.ts` + `dfbnet_imports` audit; `dfbnet.test.ts` |
| 13 | Structured logs with `requestId`, no PII | 🟢 | `recordRequest`; `X-Request-Id` header |
| 14 | Audit log for security-relevant actions | 🟢 | LOGIN_*/LOGOUT, CLUB_CREATED/DELETED, TEAM_CREATED, TEAM_STATE_SYNCED, MATCH_*, DFBNET_IMPORT_*, LEGACY_MIGRATION_*, MEMBER_INVITED/ROLE_CHANGED/STATUS_CHANGED/REMOVED, EXPORT_CREATED, USER_DELETED emitted and tested |
| 15 | Backup + restore rehearsed against staging | 🟢 | 2026-09-04 D1 Time Travel rehearsal: create marker after bookmark, restore, marker absent, migrations `0001–0015` intact; details in `runbooks/database-restore.md` |
| 16 | Rollback rehearsed | 🟢 | 2026-09-04 staging Worker rollback `0bb5189d… → d8b125f0…` and roll-forward succeeded; protected endpoint rechecked |
| 17 | Data export + deletion flows | 🟢 | `GET /clubs/:id/export`, `DELETE /clubs/:id` (cascade), `DELETE /api/v1/me` (tombstone) + `lifecycle.test.ts` (8 cases) |
| 18 | Real-Worker E2E (browser → Worker → D1) | 🟢 | `tests/worker/` against `wrangler dev --local` + local D1; CI job `e2e-worker` |
| 19 | Dedicated security suite | 🟢 | `cloudflare/test/security/{csrf,session,bola,rbac,concurrency,rate-limit}.test.ts` in the `test:worker` gate |
| 20 | Rate limiting beyond login | 🟢 | `EXPORT_RATE_LIMITER` (5/60s), `IMPORT_RATE_LIMITER` (20/60s); `core/rate-limit.ts` composite IP+account+tenant+endpoint key; `rate-limit.test.ts` |
| 21 | Legacy KV → D1 migration endpoint (idempotent, auditable) | 🟢 | authenticated list/read/migrate endpoints; verified source fingerprint, stored `legacyTenantId → club/team`, idempotency, no source deletion, audit events; `legacy-migration.test.ts` |
| 22 | Observability operational (dashboards / alerts) | 🟡 | `wrangler.jsonc` observability on; no alerting wired |
| 23 | Incident response documented | 🟢 | `docs/runbooks/incident-response.md` |

Legend: 🟢 done · 🟡 partial · 🔴 not started.

## Verdict

**CONDITIONALLY READY.** All code, data-safety, recovery and deployment gates are
green. Item 22 remains an operational follow-up: Cloudflare invocation logging
is active, but an external 5xx/auth/import-failure notification channel has not
yet been connected.

## Minimum path to READY

1. Wire at least one external alert channel for 5xx spikes, repeated auth
   failures and import failures (item 22).
2. Schedule the policy-defined retention cleanup and weekly encrypted logical
   export jobs.
