# Runbook — deployment rollback

## When to roll back

Elevated 5xx rate, broken auth, a tenant-isolation regression, or a failed
post-deploy verification step (`docs/operations/DEPLOYMENT.md`).

## Decision: code-only vs code + schema

| Situation | Action |
| --- | --- |
| Bad code, **no** migration in this release | Roll the Worker back to the previous Version. |
| Bad code, migration was **additive & backward-compatible** (new nullable column, new table, new index) | Roll the Worker back; leave the schema — the old code ignores the additions. |
| Migration was **destructive / incompatible** | Worker rollback is not enough. Use `docs/runbooks/database-restore.md` procedure A (Time Travel to just before the migration), then redeploy the previous Worker Version. Expect a maintenance window. |

Migrations `0001`–`0015` to date are additive. Keep it that way: never write a
migration that drops or rewrites a column the currently-deployed code reads.

## Code-only rollback

```
wrangler versions list                             # find the last-good Version id
wrangler rollback <version-id> --yes
# or redeploy the known-good commit:
git checkout <good-sha> && npm ci && npm run build && wrangler deploy --env production
```

Verify with the post-deploy checklist. Announce start and completion.

## After rollback

1. Confirm error rate and latency are back to baseline (Cloudflare dashboard /
   Logpush).
2. Open an incident note: what shipped, what broke, the offending commit,
   customer impact window.
3. Add a regression test that would have caught it before re-attempting the
   release.
4. If tenant isolation or personal data was affected, follow
   `docs/runbooks/incident-response.md`.

## Rehearsal log

- **2026-09-04, staging:** deployed identical versions
  `d8b125f0-838f-4234-a5d2-f0abd75a3d32` and
  `0bb5189d-7037-451f-8102-9d6019ccb6e4`; rolled back from the latter to the
  former, then rolled forward to the latter. Both control-plane operations
  succeeded; `/auth/session` still returned the expected unauthenticated `401`.
