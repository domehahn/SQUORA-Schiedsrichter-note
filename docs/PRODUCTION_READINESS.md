# Production readiness gate

A release is **READY** only when every item below is GREEN with evidence
(a passing CI run, a test file, a rehearsal log entry). Any RED item blocks
production deployment.

Status as of commit `96112ef` — 2026-09-03.

| # | Criterion | State | Evidence / what's missing |
| --- | --- | --- | --- |
| 1 | CI green on `main` | 🟢 | `.github/workflows/ci.yml`: quality + e2e + security + CodeQL |
| 2 | No secrets in the repo or history | 🟢 | CI secret guard; `docs/security` review; fixtures synthetic |
| 3 | No real test PII | 🟢 | "Max Testspieler", `0100-0001`, `@example.invalid` throughout |
| 4 | Tenant-isolation tests as merge gate | 🟢 | `cloudflare/test/{tenant,matches,teams}.test.ts` — foreign club/team/match → 404; run in `test:worker` CI job |
| 5 | RBAC tested | 🟢 | viewer cannot mutate; team-scoped referee barred from sibling team |
| 6 | Optimistic locking, no silent last-write-wins | 🟢 | `version` columns + `team_sync_versions`; 409 tests |
| 7 | D1 migrations tested | 🟡 | `applyD1Migrations` in worker tests covers `0001–0013`; **not yet applied to a real production D1** (placeholder ids in `wrangler.jsonc`) |
| 8 | Separate dev / staging / production | 🟡 | `wrangler.jsonc` env split done; real databases + secrets not yet provisioned |
| 9 | Encrypted local storage; keys memory-only | 🟢 | `encryptedCache.ts`; PBKDF2 600k / AES-256-GCM; no key in `localStorage`/logs |
| 10 | CSP without `unsafe-inline`, HSTS, frame protection | 🟢 | `core/http.ts` `SECURITY_HEADERS` + CSP |
| 11 | Service worker never caches `/api/*` `/auth/*` | 🟡 | Vite PWA `NetworkOnly` configured; automated assertion still to add (Epic 30) |
| 12 | DFBnet import validated / minimized | 🟡 | client parser + limits + whitelist + server strip done; staged server endpoint + `dfbnet_imports` audit not built (Epic 10) |
| 13 | Structured logs with `requestId`, no PII | 🟢 | `recordRequest`; `X-Request-Id` header |
| 14 | Audit log for security-relevant actions | 🟡 | CLUB/TEAM/MATCH covered; `LOGIN_*`, `MEMBER_*`, `DFBNET_*`, `EXPORT_*` not emitted (Epic 18) |
| 15 | Backup + restore rehearsed against staging | 🔴 | `docs/runbooks/database-restore.md` written; rehearsal not performed |
| 16 | Rollback rehearsed | 🔴 | `docs/runbooks/rollback.md` written; not exercised |
| 17 | Data export + deletion flows | 🔴 | `docs/privacy/*` specify them; endpoints not implemented (Epic 22) |
| 18 | Real-Worker E2E (browser → Worker → D1) | 🔴 | Playwright still runs against Vite with mocked API (Epic 24) |
| 19 | Dedicated `tests/security/` suite | 🔴 | csrf / session / import / export specs not present (Epic 25) |
| 20 | Rate limiting beyond login | 🔴 | only `LOGIN_RATE_LIMITER`; import/export/reporting unprotected (Epic 28) |
| 21 | Legacy KV → D1 migration endpoint (idempotent, auditable) | 🔴 | read-only compat only; no authenticated migration endpoint (Epics 33–34) |
| 22 | Observability operational (dashboards / alerts) | 🟡 | `wrangler.jsonc` observability on; no alerting wired |
| 23 | Incident response documented | 🟢 | `docs/runbooks/incident-response.md` |

Legend: 🟢 done · 🟡 partial · 🔴 not started.

## Verdict

**NOT READY.** Blocking (🔴): items 15–21. Must-fix-before-launch (🟡):
items 7, 8, 11, 12, 14.

## Minimum path to READY

1. Provision real D1 databases for staging + production; apply migrations
   `0001–0013`; fill `wrangler.jsonc` ids (items 7, 8).
2. Rehearse restore and rollback against staging; record RTO (items 15, 16).
3. Implement `GET /clubs/:id/export` and club/user deletion with cascade + audit
   (item 17).
4. Add the Wrangler/Miniflare Playwright suite and `tests/security/` gate
   (items 18, 19).
5. Extend rate limiting to import/export; emit the remaining audit actions
   (items 20, 14).
6. Add a service-worker cache assertion; build the staged DFBnet import endpoint
   (items 11, 12).
