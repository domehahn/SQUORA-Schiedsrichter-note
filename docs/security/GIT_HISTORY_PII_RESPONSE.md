# Runbook — personal data / secrets in Git history

The repository is **public**. Anything ever committed stays reachable in history
and in every fork/clone until the history is rewritten *and* every downstream
copy re-syncs. This runbook covers detection, assessment and, only if justified,
removal.

## Standing rule

> No real DFBnet data, personal data, credentials or secrets in Git, tests,
> screenshots, issues, logs or CI artefacts. Fixtures use the documented
> synthetic convention: `Max Testspieler`, `Anna Beispiel`, `Kim Musterkind`,
> `@example.invalid` / `@e2e.invalid`, pass numbers `0100-000x`, nationality
> `XX`, clubs `FC Beispielstadt` / `SV Testverein`, teams `Team A` / `Team B`.

## Automated detection (CI `security` job)

| Check | Scope | Fails on |
| --- | --- | --- |
| `gitleaks/gitleaks-action@v2` (`.gitleaks.toml`) | full history (`fetch-depth: 0`) | secrets / keys / tokens; synthetic hashes allow-listed |
| `git grep` working-tree guard | HEAD | `AUTH_PASSWORD_HASH=`, real-looking PBKDF2 hash, `BEGIN … PRIVATE KEY` |
| `scripts/check-pii-history.mjs` | full history | free-mail addresses; DFBnet export column headers (`Spielrecht ab`, `Reg. am`, …) outside test paths |

`check-pii-history.mjs` keeps an `ACKNOWLEDGED` list: reviewed findings are
printed as a notice but do not fail the build. New findings fail.

## Assessed findings (2026-09-04, full history, HEAD `5bac35b`)

| Finding | Locations | Assessment | Action |
| --- | --- | --- | --- |
| Repo owner's own address `dominik87hahn@gmail.com` | `wrangler.jsonc`, `worker-configuration.d.ts`, early `cloudflare/test/*` in commits `543622438d`, `4cc31c8459`, `3199a50af9`, `5495dde390`, `f88dfe433e` (removed from HEAD) | Self-published address of the sole maintainer; not third-party data; no special-category data; not a credential | **Accepted.** Listed in `ACKNOWLEDGED`. History rewrite optional (see below); no urgency. |
| Test PBKDF2 hashes (`0…0` dummy, `0101…` salt) and `unit-test-session-secret-…` | many `*.test.ts`, `scripts/hash-password.mjs` | Synthetic; password/secret value is public and worthless | **Accepted.** Allow-listed in `.gitleaks.toml`. |
| Real production password hash | — | **Never committed.** Lives only in D1 `users`. | none |
| DFBnet birth dates / pass numbers of real people | — | **None found.** All fixtures follow the `0100-000x` / synthetic-name convention. | none |

No secrets were exposed, so **no credential rotation is required**. If a future
finding involves a real secret, rotate it first (before any history rewrite):
Cloudflare API tokens in the account dashboard, `wrangler secret put …` for
worker secrets, session invalidation via `sessions` table truncation.

## If a real removal is ever justified

Do **not** run an automatic force-rewrite. Follow this controlled plan:

1. **Freeze**: announce, pause merges to `main`, snapshot the repo
   (`git clone --mirror`).
2. **Rotate** any real secret involved (see above) — assume it is already
   compromised.
3. **Scope** the blobs precisely:
   `git log --all --oneline -S '<string>' -- <path>` and
   `git rev-list --all --objects | git cat-file --batch-check`.
4. **Rewrite** with `git filter-repo` (not `filter-branch`):
   ```bash
   pip install git-filter-repo
   git filter-repo --replace-text <(printf '<literal>==><redacted>\n')
   # or: git filter-repo --path <file> --invert-paths   # to drop a whole file
   ```
5. **Force-push** all refs and tags: `git push --force --all` /
   `git push --force --tags`. Every open PR must be rebased or recreated;
   commit SHAs change.
6. **Downstream**: every existing clone/fork keeps the old objects. Ask GitHub
   Support to garbage-collect and to purge cached views; contact fork owners.
   Treat the data as already disclosed for the exposure window.
7. **Data-protection**: if real personal data of a third party was involved,
   record the exposure window, the data categories, the affected count and the
   remediation; assess Art. 33/34 GDPR notification with the controller. Do not
   copy the personal data into this document or the incident ticket.
8. **Verify**: re-run the full CI `security` job on the rewritten history;
   confirm `check-pii-history.mjs` is clean and the `ACKNOWLEDGED` entry can be
   removed.

## Prevention

- Keep fixtures synthetic; never paste a real export into a test, issue or PR.
- `git grep` your change before committing anything under `src/integrations/dfbnet`,
  `cloudflare/api/dfbnet.ts` or the fixture files.
- Screenshots in issues/PRs must use synthetic data only.
