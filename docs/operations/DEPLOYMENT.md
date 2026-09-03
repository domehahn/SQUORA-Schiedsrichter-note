# Deployment

## Environments

| Env | Worker | Domain | D1 database | Login limiter |
| --- | --- | --- | --- | --- |
| development | `schiedsrichter-note-web-development` | `workers.dev` | `schiedsrichter-note-development` | 20 / 60 s |
| staging | `schiedsrichter-note-web-staging` | `schiri-staging.squora.de` | `schiedsrichter-note-staging` | 10 / 60 s |
| production | `schiedsrichter-note-web` | `schiri.squora.de` | `schiedsrichter-note-production` | 10 / 60 s |

Each environment has its own D1 database, rate-limiter namespace and secrets.
No production data is ever copied into staging or development.

> The `database_id`s in `wrangler.jsonc` are placeholders
> (`00000000-0000-4000-8000-00000000000X`). Before any real deploy, create the
> databases with `wrangler d1 create` and paste the real ids.

## One-time setup per environment

```
wrangler d1 create schiedsrichter-note-<env>
# put the id into wrangler.jsonc
wrangler d1 migrations apply schiedsrichter-note-<env> --env <env> --remote
wrangler secret put AUTH_USERS --env <env>          # bootstrap accounts
wrangler secret put SESSION_PEPPER --env <env>      # if configured
```

## Release flow

1. Push / PR → GitHub Actions `ci.yml` runs: typecheck, lint, build,
   unit + worker tests, Playwright, `npm audit`, secret scan, CodeQL.
2. Merge to `main` only with all required checks green (branch protection).
3. Build once: `npm run build` produces the immutable `dist/` artifact
   (uploaded by CI).
4. Apply any new migrations to the target env **before** the code that needs
   them: `wrangler d1 migrations apply schiedsrichter-note-<env> --env <env> --remote`.
5. Deploy: `wrangler deploy --env staging`, verify, then
   `wrangler deploy --env production`.
6. Cloudflare keeps prior Worker **Versions**; note the deployed version id in
   the release notes for rollback.

## Post-deploy verification

- `GET /api/v1/me` unauthenticated → 401 with `{ error, requestId }`.
- Login form → session cookie `HttpOnly; Secure; SameSite=Strict`.
- `GET /api/v1/clubs` returns only the caller's active memberships.
- A foreign club id → 404 (not 403, not 500).
- Response carries CSP without `unsafe-inline`, HSTS, `X-Request-Id`.
- Service worker: `/api/*` responses are not in Cache Storage.

## Rollback

See `docs/runbooks/rollback.md`.
