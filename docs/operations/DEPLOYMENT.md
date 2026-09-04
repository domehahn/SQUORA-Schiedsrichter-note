# Deployment

## Environments

| Env | Worker | Domain | D1 database | D1 id | Login limiter |
| --- | --- | --- | --- | --- | --- |
| development | `schiedsrichter-note-web-development` | `workers.dev` | `schiedsrichter-note-development` | `1b56a7b7-90ad-4235-bcd8-4f80ef8756fb` | 20 / 60 s |
| staging | `schiedsrichter-note-web-staging` | `schiri-staging.squora.de` | `schiedsrichter-note-staging` | `0bc2a1b5-cc28-46a8-8762-aeb446aa01e6` | 10 / 60 s |
| production | `schiedsrichter-note-web` | `squora.de/schiedsrichter-note*` | `schiedsrichter-note-production` | `25faaf18-f659-48aa-9d50-01ebc38fb931` | 10 / 60 s |

Each environment has its own D1 database, three rate-limiter namespaces and its
own secrets. **No production data is ever copied into staging or development.**
Production is mounted at a path (`squora.de/schiedsrichter-note/`) by product
decision — see the origin-isolation note in `docs/PRODUCTION_READINESS.md`.

## Runtime model (what actually exists)

- **Accounts live only in D1 `users`.** There is no `AUTH_USERS`, no
  `SESSION_PEPPER`, no `SESSION_SECRET`. The first owner account is created with
  `scripts/hash-password.mjs` (emits `pbkdf2-sha256$i=600000$…`) and a single
  `INSERT`. Everyone else joins through an invitation token
  (`docs/architecture/…` / `api/invitations.ts`).
- **Sessions** are random 256-bit tokens; only `SHA-256(token)` is stored.
- **Password hashing**: PBKDF2-HMAC-SHA256. New/rotated hashes use a single
  600 000-iteration `node:crypto` call (`pbkdf2-sha256$i=600000$…`); the runtime
  falls back to 6×100 000 chained WebCrypto rounds if `node:crypto` PBKDF2 is
  unavailable. Legacy hashes verify and are rehashed on next login. **Confirm
  the `i=` path works on the real runtime on staging after any KDF change**
  (`wrangler tail` during a login; a 500 with "iteration counts above 100000"
  means the fallback must be forced).
- **No `LEGACY_DATA` KV binding in production** (KV→D1 migration complete,
  blobs deleted 2026-09-04). The legacy routes are guarded and return empty.
- **Secrets**: only `ALERT_WEBHOOK_URL` (optional; see
  `docs/runbooks/alert-delivery.md`).

## One-time setup per environment

```sh
wrangler d1 create schiedsrichter-note-<env> --location weur   # EU (see below)
# paste the id into wrangler.jsonc
wrangler d1 migrations apply schiedsrichter-note-<env> --env <env> --remote
# production owner account only:
node scripts/hash-password.mjs   # paste password on the prompt, copy the hash
#   then one INSERT INTO users (...) with that hash via `wrangler d1 execute`
wrangler secret put ALERT_WEBHOOK_URL --env <env>   # optional
```

### D1 EU jurisdiction — Go-Live requirement

Data residency cannot be proven from the repo. Verify per environment and record
the output in the release notes:

```sh
wrangler d1 info schiedsrichter-note-<env>    # "created_in_region" must be an EU region (weur / eeur)
```

or Dashboard → D1 → database → *Location*. All three databases must be EU.
Note: an EU D1 database does **not** by itself pin every Worker invocation to
the EU. If strict processing-location guarantees are required, evaluate
Cloudflare **Regional Services** and the **Customer Metadata Boundary** as a
separate governance item. Do not state unqualified "GDPR compliant" — state
"D1 storage region = EU, verified on YYYY-MM-DD".

## Release flow

1. Push / PR → GitHub Actions `ci.yml`: typecheck, lint, build, service-worker
   check, unit + worker tests, Playwright, Worker+D1 E2E, `npm audit`
   (`--audit-level=high`, hard fail), gitleaks full-history, PII history guard,
   CodeQL. `main` branch protection requires them (see
   `docs/operations/branch-protection.md`).
2. Merge to `main` only with every required check green.
3. `npm run build` → immutable `dist/`.
4. **Migrations before code**: `wrangler d1 migrations apply
   schiedsrichter-note-<env> --env <env> --remote`.
5. Deploy staging: `wrangler deploy --env staging`, then run the remote smoke:
   `STAGING_URL=… STAGING_TEST_EMAIL=… STAGING_TEST_PASSWORD=… npm run test:e2e:staging`
   (CI does this automatically as the `staging-e2e` job when `RUN_STAGING_E2E`
   is enabled).
6. Deploy production: `wrangler deploy --env production`.
7. Record the deployed **Version id** (`wrangler deployments list`) in the
   release notes for rollback.

## Post-deploy verification (run against the deployed URL)

- `GET /api/v1/me` unauthenticated → 401 `{ error, requestId }`.
- Login → cookie `HttpOnly; Secure; SameSite=Strict`, **no `Domain=`**.
- `GET /api/v1/clubs` → only the caller's active memberships.
- Foreign club id → 404 (never 403 / 500).
- Response headers: CSP without `unsafe-inline`, HSTS `max-age`, `X-Request-Id`.
- Service worker: `/api/*` responses are **not** in Cache Storage.
- `wrangler tail --env production` for one real login: no
  `Pbkdf2 failed` / 5xx.
- `wrangler deployments list --env production` shows the expected Version id.

## Alerts

`ALERT_WEBHOOK_URL` (Slack-compatible incoming webhook) must be set in
production for the daily cron self-check to deliver. Verify delivery once with a
synthetic event — `docs/runbooks/alert-delivery.md`. `PRODUCTION_READINESS.md`
keeps observability **yellow** until a real delivery is recorded.

## Rollback & restore

- Roll back code: `docs/runbooks/rollback.md` (`wrangler rollback` /
  `wrangler deploy` a prior Version).
- Restore data: `docs/runbooks/database-restore.md` (D1 Time Travel; capture the
  bookmark **before** any destructive operation).
