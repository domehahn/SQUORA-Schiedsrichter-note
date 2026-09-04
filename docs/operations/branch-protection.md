# Branch protection — `main`

## Verified state (`gh api …/branches/main/protection`, 2026-09-04)

| Setting | Value | Note |
| --- | --- | --- |
| Required status checks | the 5 below | enforced |
| Strict (branch up to date before merge) | **on** | |
| Require linear history | **on** | |
| Require conversation resolution | **on** | |
| Allow force pushes | **off** | |
| Allow deletions | **off** | |
| Require a pull request before merging | **off** | single-maintainer repo — see below |
| Required approving reviews | none | |
| Include administrators (`enforce_admins`) | **off** | documented break-glass; the maintainer pushes to `main` directly |

**Single-maintainer model.** The repo currently has one maintainer, so a
mandatory PR-review gate would hard-block every merge (you cannot approve your
own PR). Instead: the CI checks are required and strict, force-push/deletion are
blocked, and history stays linear. `PRODUCTION_READINESS.md` reflects this as a
residual risk, not as "PR review enforced".

**When a second maintainer joins**, tighten to:

- **Require a pull request before merging** — on, ≥ 1 approval, dismiss stale
  approvals on new commits.
- **Include administrators** — on.
- **Restrict who can push** — maintainers only, no direct pushes.

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
