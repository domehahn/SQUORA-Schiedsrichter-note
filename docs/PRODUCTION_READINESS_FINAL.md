# Production readiness — final assessment

Commit `1386a57`+, 2026-09-04. Evidence-based only: a control is 🟢 solely on a
passing CI run, a test file, a migration, or a recorded rehearsal. Anything that
depends on live Cloudflare / GitHub configuration that the repo cannot prove is
🟡 until a maintainer records the verification.

## Executive summary

**CONDITIONALLY READY.**

No P0 remains open. Cross-tenant and cross-team isolation, authentication, the
invitation lifecycle, DFBnet data minimisation, offline-cache crypto, D1 EU
region, the CI gates and full-history scanning are 🟢 with test/CI evidence.
Four controls are 🟡 pending a **one-time operational verification** that code
cannot substitute for: alert-channel delivery, real-runtime (`workerd`)
confirmation of the `i=` PBKDF2 path via the staging smoke, the weekly
off-platform export job, and — accepted as a governance assumption — origin
isolation. Branch protection is verified but keeps a residual risk (no
PR-review gate, single maintainer). None of these are code defects.

If any 🟡 below cannot be verified before go-live, that row is **NOT READY** and
the release is NOT READY.

## Control table

| Control | Status | Evidence | Residual risk |
| --- | --- | --- | --- |
| Cross-tenant isolation | 🟢 | `middleware/tenant.ts` deny-by-default; `security/bola.test.ts`, `test/{tenant,matches,teams}.test.ts` — foreign club/team/match/export/import/member → 404 | A new endpoint that forgets `requireTenantAccess`; mitigated by the pattern + tests, not statically enforced |
| Cross-team isolation | 🟢 | `security/cross-team.test.ts` — sibling-team match/tournament id via `/state` delta → 404, row untouched; `ON CONFLICT … WHERE team_id=excluded.team_id`; team-scoped event deletes; `denyTeamScoped` on club-wide endpoints | `matches`/`tournaments` PK is still `(club_id,id)`; the ownership guard + WHERE clause close the hole without a table rebuild — a future `INSERT` path that bypasses `putState`/`matches.ts` would need the same guard |
| Authentication & sessions | 🟢 | random 256-bit token, `SHA-256` at rest, `HttpOnly; Secure; SameSite=Strict`, host-only, 8 h; `optionalAuth` re-checks status + revocation every request; `auth.test.ts` | — |
| Invitation lifecycle | 🟢 | `api/invitations.ts` + `invitations.test.ts` (10 cases): 256-bit token, hash at rest, 7-day expiry, one-time, generic 404, no auto-activation of existing accounts, email-match on accept, club-scoped revoke | Public `GET /invitations/:token` + `register` are rate-limited by IP only (shared-NAT users share a bucket) |
| Password security | 🟡 | PBKDF2-HMAC-SHA256; versioned format; `verifyPassword` → `{ok, needsRehash}`; rehash-on-login; `hash-password.mjs` emits `i=600000` | The single-call `node:crypto` PBKDF2 path is probed at runtime but has **not** been confirmed on real `workerd` — verify on staging via `wrangler tail` during a login before relying on it; the 6×100 000 chained fallback is proven in Miniflare |
| DFBnet security & minimisation | 🟢 | two server whitelists (`core/dfbnet.ts`); `dfbnet.test.ts`, `matches.test.ts` — nationality/eligibility/registration stripped everywhere; birthdate only on `players`; raw CSV never stored/logged; staged endpoint + fingerprint + `IMPORT_RATE_LIMITER`; import writes + status flip in one batch | Pass number now persists in the `/state` blob + match archive by product decision (documented, `DFBNET_DATA_HANDLING.md`) |
| Data minimisation (privacy-by-design) | 🟢 | `DATA_CLASSIFICATION.md` checklist; `DFBNET_DATA_HANDLING.md` per-field table with purpose, audience, retention, legal basis; minor-data assessment in `ADR-001` | Birthdate retention is "until the player is removed" — relies on rosters actually being pruned |
| Offline encryption | 🟢 | `encryptedCache.ts` AES-256-GCM, PBKDF2 ≥ 600 000, key non-extractable & memory-only, never `localStorage`/logs; passphrase ≥ 12; gate asks only when a cache exists | Ciphertext remains on the device after logout by design (documented) |
| Player lifecycle audit | 🟢 | `PLAYER_CREATED/UPDATED/DELETED` with clubId/teamId/playerId + changed field names only; `players.test.ts` | — |
| CI | 🟢 | `ci.yml`: typecheck, oxlint, build, SW-policy, unit (38), worker (89), Playwright (19), Worker+D1 E2E (5), `npm audit --audit-level=high` (hard fail), CodeQL | — |
| Full-history security scan | 🟢 | `security` job `fetch-depth: 0` + `gitleaks-action@v2` (`.gitleaks.toml`) + `check-pii-history.mjs`; `GIT_HISTORY_PII_RESPONSE.md` assessed findings (only the maintainer's own address, no secrets, no third-party PII) | History still contains that address; rewrite plan documented, not executed |
| Cloudflare staging runtime verification | 🟡 | `playwright.staging.config.ts` + `tests/staging/smoke.spec.ts` + gated `staging-e2e` CI job (auth 401, CSRF 403, cookie flags, foreign-id 404, CSP) | Not yet run — needs `RUN_STAGING_E2E`, `CLOUDFLARE_*` and `STAGING_*` secrets/vars set, and a first green run recorded |
| D1 EU jurisdiction | 🟢 | `wrangler d1 list` on 2026-09-04: `schiedsrichter-note-{development,staging,production}` all report `jurisdiction = eu`. Re-verify after any DB recreation (`DEPLOYMENT.md`) | An EU D1 database does not pin every Worker invocation to the EU — see the origin/localisation note; Regional Services / Customer Metadata Boundary remain a separate governance option |
| Origin isolation | 🟡 (accepted) | Product decision to stay on `squora.de/schiedsrichter-note/`; path is not a browser security boundary | Any XSS in another app on `squora.de` could reach this app's API on the shared origin. Governance assumption: **no other third-party/CMS app shares that origin.** Must be confirmed and kept true |
| Backup / restore | 🟢 | 2026-09-04 D1 Time Travel rehearsal (marker after bookmark → restore → marker gone, migrations intact); `runbooks/database-restore.md`; production wipe on 2026-09-04 captured a bookmark first | Weekly off-platform logical `wrangler d1 export` is still policy-only (🟡 as its own line below) |
| Weekly off-platform export | 🟡 | documented in `DATA_RETENTION.md` | Job not implemented — manual `wrangler d1 export` until then |
| Rollback | 🟢 | 2026-09-04 staging Worker rollback + roll-forward rehearsal; `runbooks/rollback.md`; deploy flow records the Version id | — |
| Audit | 🟢 | auth/session, club/team/state/match, player, DFBnet, legacy, membership, invitation, export, deletion actions emitted and tested; no PII / tokens / CSV in metadata | — |
| Alerting | 🟡 | `services/alerting.ts` thresholds + daily cron; `runbooks/alert-delivery.md` (synthetic verification procedure) | `ALERT_WEBHOOK_URL` must be set in production **and** one delivery recorded before this is 🟢 |
| Branch protection | 🟡 | verified via `gh api` on 2026-09-04 (`operations/branch-protection.md`): 5 required checks, strict, linear history, conversation resolution, no force-push/deletion | **No PR-review gate** and `enforce_admins:off` — a single-maintainer model where the maintainer pushes to `main` directly. Tighten (require PR + reviews + include-admins) when a second maintainer joins |
| GDPR operational controls | 🟡 | export (`GET /clubs/:id/export`, now incl. first/last name, pass number, birthdate for portability), account tombstone (`DELETE /me`), 30-day club-deletion grace + cron purge (all club tables incl. `invitations` / `legacy_migrations`, `lifecycle.test.ts` asserts no orphans), retention trims (sessions / `audit_log` 24 mo / `dfbnet_imports` 12 mo / terminal `invitations` 90 d); `privacy/*` docs | D1-EU verified; a data-processing record must be maintained outside the repo |

## Explicit area verdicts

- **Cross-tenant isolation** — 🟢. Server-resolved membership before every query; foreign ids are 404.
- **Cross-team isolation** — 🟢. Body-id BOLA on `/state` closed and regression-tested.
- **Authentication** — 🟢.
- **Invitation lifecycle** — 🟢. Token possession required; existing accounts never silently joined.
- **Password security** — 🟡. Standard primitive, versioned, migrating; confirm the preferred path on real `workerd`.
- **DFBnet security / data minimisation** — 🟢.
- **Offline encryption** — 🟢.
- **CI** — 🟢.
- **Full-history security scan** — 🟢.
- **Cloudflare staging** — 🟡. Suite + job exist; first green run outstanding.
- **D1 EU** — 🟢. All three databases `jurisdiction = eu` (`wrangler d1 list`, 2026-09-04).
- **Origin isolation** — 🟡, accepted as a governance assumption.
- **Backup / restore** — 🟢 (Time Travel); weekly export job 🟡.
- **Rollback** — 🟢.
- **Audit** — 🟢.
- **Alerting** — 🟡. Secret + one recorded delivery outstanding.
- **Branch protection** — 🟡. Checks + strict + linear history + no force-push verified; no PR-review gate (single maintainer).
- **GDPR operational controls** — 🟡, gated on D1-EU.

## Path to READY

1. Run the `wrangler d1 info` check for dev/staging/production; record "EU, YYYY-MM-DD".
2. `wrangler secret put ALERT_WEBHOOK_URL --env production`; run the synthetic delivery test (`runbooks/alert-delivery.md`); record it.
3. Set `RUN_STAGING_E2E=true` + `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` / `STAGING_URL` / `STAGING_TEST_EMAIL` / `STAGING_TEST_PASSWORD`; get one green `staging-e2e` run; during it, `wrangler tail` a login and confirm no `Pbkdf2 failed`.
4. (When a 2nd maintainer joins) enable the PR-review gate + `enforce_admins` on `main`.
5. Confirm no other app shares the `squora.de` origin; record it as a governance assumption.
6. Implement (or schedule) the weekly `wrangler d1 export`.

When 1–5 are recorded, this document moves to **READY**. Item 6 may remain a
tracked operational follow-up if a manual weekly export is performed in the
interim.
