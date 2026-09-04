# Branch protection — `main`

GitHub branch-protection state cannot be proven from the repository. This file
is the source of truth for what **must** be configured; `PRODUCTION_READINESS.md`
may only call CI/CD green once a maintainer has confirmed these settings match.

## Required settings (Settings → Branches → `main`)

- **Require a pull request before merging** — yes.
  - Require approvals: ≥ 1.
  - Dismiss stale approvals on new commits: yes.
- **Require status checks to pass before merging** — yes, *and* "Require
  branches to be up to date before merging" (strict).
- **Require linear history** — yes.
- **Require conversation resolution before merging** — yes.
- **Do not allow bypassing the above** / "Include administrators": the repo has
  historically kept `enforce_admins: false` as a break-glass path for the sole
  maintainer. If more than one person can push, set it to `true`.
- **Restrict who can push to matching branches** — only the maintainer(s) / no
  direct pushes.
- **Allow force pushes** — no. **Allow deletions** — no.

## Required status checks (exact names from `ci.yml`)

| Check (job name) | Gate |
| --- | --- |
| `Typecheck, lint, unit & worker tests, build` | typecheck · oxlint · SW cache policy · unit · worker (Miniflare + D1) · build |
| `End-to-end (Playwright)` | Vite-served browser E2E |
| `End-to-end against the real Worker (wrangler dev + D1)` | browser → real Worker → D1 |
| `Dependency, secret & PII scan` | `npm audit --audit-level=high` (hard fail) · gitleaks full history · working-tree secret guard · `check-pii-history.mjs` |
| `CodeQL` | static analysis |

`Remote smoke against deployed staging` (`staging-e2e`) is **conditionally**
required: enable it as a required check only once `RUN_STAGING_E2E` and the
`CLOUDFLARE_*` / `STAGING_*` secrets are configured, otherwise it is skipped and
must not be marked required (a skipped required check blocks all merges).

## Never

- `continue-on-error` on any security job.
- Downgrading `npm audit` below `--audit-level=high` or to non-blocking.
- Removing a check to unblock a merge.

## Verification

A maintainer records, in the release notes for the go-live:
`branch protection reviewed on YYYY-MM-DD, matches docs/operations/branch-protection.md`.
