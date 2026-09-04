# Production readiness gate

A release is **READY** only when every item below is GREEN with evidence
(a passing CI run, a test file, a rehearsal log entry). Any RED item blocks
production deployment.

Status as of commit `351afdb` — 2026-09-04. The full evidence-based control
assessment is `docs/PRODUCTION_READINESS_FINAL.md`; this table is the release
checklist.

| # | Criterion | State | Evidence / what's missing |
| --- | --- | --- | --- |
| 1 | CI green on `main` | 🟢 | `.github/workflows/ci.yml`: quality + e2e + e2e-worker + security + CodeQL |
| 2 | No secrets in the repo or history | 🟢 | CI secret guard; `docs/security` review; fixtures synthetic |
| 3 | No real test PII | 🟢 | "Max Testspieler", `0100-0001`, `@example.invalid` / `@e2e.invalid` throughout |
| 4 | Tenant-isolation tests as merge gate | 🟢 | `cloudflare/test/{tenant,matches,teams}.test.ts` + `security/bola.test.ts` — foreign club/team/match/export/import → 404; `test:worker` CI job |
| 5 | RBAC tested | 🟢 | `security/rbac.test.ts`: viewer read-only, referee cannot delete/manage/import/export, only owner deletes club |
| 6 | Optimistic locking, no silent last-write-wins | 🟢 | `version` columns + `team_sync_versions`; `security/concurrency.test.ts` |
| 7 | D1 migrations tested + applied | 🟢 | `applyD1Migrations` covers `0001–0018`; applied to real EU D1 (dev/staging/production); prod deploy 2026-09-04 applied 0017+0018, migration list clean |
| 8 | Separate dev / staging / production | 🟢 | `wrangler.jsonc` env split; three real EU D1 databases; per-env rate-limiter namespaces; `env.development` pins `routes:[]` |
| 9 | Encrypted local storage; keys memory-only | 🟢 | `encryptedCache.ts`; PBKDF2 600k / AES-256-GCM; no key in `localStorage`/logs |
| 10 | CSP without `unsafe-inline`, HSTS, frame protection | 🟢 | `core/http.ts` `SECURITY_HEADERS` + CSP |
| 11 | Service worker never caches `/api/*` `/auth/*` | 🟢 | Vite PWA `NetworkOnly`; `scripts/verify-service-worker.mjs` inspects the generated worker and runs in CI |
| 12 | DFBnet import validated / minimized | 🟢 | client parser + limits + whitelist + server re-minimize + staged endpoint `cloudflare/api/dfbnet.ts` + `dfbnet_imports` audit; `dfbnet.test.ts` |
| 13 | Structured logs with `requestId`, no PII | 🟢 | `recordRequest`; `X-Request-Id` header |
| 14 | Audit log for security-relevant actions | 🟢 | LOGIN_*/LOGOUT, CLUB_CREATED/DELETED, TEAM_CREATED, TEAM_STATE_SYNCED, MATCH_*, DFBNET_IMPORT_*, LEGACY_MIGRATION_*, MEMBER_INVITED/ROLE_CHANGED/STATUS_CHANGED/REMOVED, EXPORT_CREATED, USER_DELETED emitted and tested |
| 15 | Backup + restore rehearsed against staging | 🟢 | 2026-09-04 D1 Time Travel rehearsal: create marker after bookmark, restore, marker absent, migrations intact; details in `runbooks/database-restore.md` |
| 16 | Rollback rehearsed | 🟢 | 2026-09-04 staging Worker rollback `0bb5189d… → d8b125f0…` and roll-forward succeeded; protected endpoint rechecked |
| 17 | Data export + deletion flows | 🟢 | `GET /clubs/:id/export`, `DELETE /clubs/:id` (cascade), `DELETE /api/v1/me` (tombstone) + `lifecycle.test.ts` (8 cases) |
| 18 | Real-Worker E2E (browser → Worker → D1) | 🟢 | `tests/worker/` against `wrangler dev --local` + local D1; CI job `e2e-worker` |
| 19 | Dedicated security suite | 🟢 | `cloudflare/test/security/{csrf,session,bola,cross-team,rbac,concurrency,rate-limit}.test.ts` in the `test:worker` gate |
| 20 | Rate limiting beyond login | 🟢 | `EXPORT_RATE_LIMITER` (5/60s), `IMPORT_RATE_LIMITER` (20/60s); `core/rate-limit.ts` composite IP+account+tenant+endpoint key; `rate-limit.test.ts` |
| 21 | Legacy KV → D1 migration endpoint (idempotent, auditable) | 🟢 | authenticated list/read/migrate endpoints; verified source fingerprint, stored `legacyTenantId → club/team`, idempotency, no source deletion, audit events; `legacy-migration.test.ts` |
| 22 | Observability operational (dashboards / alerts) | 🟡 | invocation logging on; daily cron (`services/alerting.ts`) posts a summary to `ALERT_WEBHOOK_URL` when thresholds are crossed — needs the secret **and one recorded synthetic delivery** (`docs/runbooks/alert-delivery.md`) |
| 23 | Incident response documented | 🟢 | `docs/runbooks/incident-response.md` |
| 24 | Invitation lifecycle (token possession, no auto-join) | 🟢 | `api/invitations.ts` + `invitations.test.ts` (10 cases); `migration 0018` |
| 25 | Full-history secret + PII scan | 🟢 | `security` job `fetch-depth: 0` + gitleaks + `check-pii-history.mjs`; `docs/security/GIT_HISTORY_PII_RESPONSE.md` |
| 26 | D1 EU region verified | 🟢 | `wrangler d1 list` 2026-09-04: dev/staging/production all `jurisdiction = eu` |
| 27 | `main` branch protection reviewed | 🟡 | `docs/operations/branch-protection.md`; maintainer must confirm + record |
| 28 | Remote staging runtime smoke green | 🟡 | `tests/staging/smoke.spec.ts` + gated `staging-e2e` job; first green run + `wrangler tail` KDF check outstanding |

Legend: 🟢 done · 🟡 partial · 🔴 not started.

## Verdict

**CONDITIONALLY READY.** All code, data-safety, recovery and deployment gates are
green. Item 22 is code-complete (a daily cron runs retention cleanup and a
threshold self-check) but needs `ALERT_WEBHOOK_URL` set as a production secret to
actually deliver notifications.

## Minimum path to READY

1. `wrangler secret put ALERT_WEBHOOK_URL` in production + one recorded synthetic
   delivery (`docs/runbooks/alert-delivery.md`) — item 22.
2. Review `main` branch protection against `docs/operations/branch-protection.md`;
   record the date — item 27.
3. Enable and get one green `staging-e2e` run; `wrangler tail` a staging login to
   confirm the `i=` PBKDF2 path (no `Pbkdf2 failed`) — item 28.
4. Add the weekly logical `wrangler d1 export` job (daily retention already runs
   via `triggers.crons`).
