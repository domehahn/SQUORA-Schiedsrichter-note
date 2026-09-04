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
| `gitleaks` (`.gitleaks.toml`), explicit CLI with `--log-opts="--all"` | full history, every reachable commit (verified count logged) | secrets / keys / tokens; synthetic hashes allow-listed |
| `git grep` working-tree guard | HEAD | `AUTH_PASSWORD_HASH=`, real-looking PBKDF2 hash, `BEGIN … PRIVATE KEY` |
| `scripts/check-pii-history.mjs` | full history, **test fixtures included** | free-mail addresses; DFBnet export rows whose birthdate/pass-number/name don't follow the synthetic convention |

`check-pii-history.mjs` keeps an `ACKNOWLEDGED` list: reviewed findings are
printed as a notice but do not fail the build. New findings fail. As of
2026-09-04 the gitleaks invocation was changed from the `gitleaks-action@v2`
default (which silently scanned only the single pushed commit —
`--log-opts=-1` — despite `fetch-depth: 0`) to an explicit CLI call that
walks every reachable commit on every ref; the PII scanner's former blanket
exemption for `*.test.ts` / `cloudflare/test/**` / `tests/**` was removed at
the same time and replaced with a content-based synthetic-fixture classifier
(see the script for the exact rule). That change is what surfaced the
incident below.

## Assessed findings (2026-09-04, full history including test fixtures, HEAD `1a3f71f`)

| Finding | Locations | Assessment | Action |
| --- | --- | --- | --- |
| Repo owner's own address `dominik87hahn@gmail.com` | `wrangler.jsonc`, `worker-configuration.d.ts`, early `cloudflare/test/*` | Self-published address of the sole maintainer; not third-party data; no special-category data; not a credential | **Accepted.** Listed in `ACKNOWLEDGED`. History rewrite optional; no urgency. |
| Test PBKDF2 hashes (`0…0` dummy, `0101…` salt) and `unit-test-session-secret-…` | many `*.test.ts`, `scripts/hash-password.mjs` | Synthetic; password/secret value is public and worthless | **Accepted.** Allow-listed in `.gitleaks.toml`. |
| Real production password hash | — | **Never committed.** Lives only in D1 `users`. | none |
| **Real DFBnet roster data (3 real minors' first/last names, birthdates and pass numbers, plus a real club name) in `src/dfbnet.test.ts` and `tests/features.spec.ts`** | Introduced 2026-09-03, superseded the same evening by the current `Max Testspieler` / `Anna Beispiel` / `Kim Musterkind` fixture, but the real data remained reachable in the superseded commits until this incident was found and fixed on 2026-09-04. **Confirmed real by the repo owner.** | **Confirmed real. Incident.** History rewritten (`git filter-repo --replace-text`, mapping the exact real rows to the standard synthetic fixture) and force-pushed to `main`. See "Incident 2026-09-04" below. | **Done.** No further data in scope; no credential involved so no key/token rotation needed. |

No secrets were exposed by the gitleaks/credential checks, so no credential
rotation is required for that class of finding. If a future finding involves
a real secret, rotate it first (before any history rewrite): Cloudflare API
tokens in the account dashboard, `wrangler secret put …` for worker secrets,
session invalidation via `sessions` table truncation.

## Incident 2026-09-04 — real DFBnet fixture data in history

**What happened:** while building the DFBnet CSV import feature, a real
DFBnet roster export (three players' full names, birthdates and pass
numbers, and the real club name) was used directly as a test fixture in
`src/dfbnet.test.ts` and `tests/features.spec.ts` instead of synthetic data.
It was replaced with the proper `Max Testspieler` convention in the very
next commit that day, but the earlier commits carrying the real data stayed
reachable in Git history — and this is a **public** repository.

**How it was found:** broadening `check-pii-history.mjs` to scan test
fixtures (this session's own CI-hardening work) surfaced the DFBnet-header
hit; inspecting the flagged commits showed a real-looking name/date/pass-
number combination that didn't fit the documented synthetic convention. The
repo owner confirmed it was real data from an actual club, not fabricated.

**Exposure window:** from whichever push first published commit `191cfe1`
("feat: DFBnet roster CSV import", pre-rewrite hash `3199a50af9`) to
2026-09-04 when the rewrite below was force-pushed. Single-maintainer repo,
no known forks or external clones as of this assessment — but per the
standing rule below, the repository being public means the data must be
treated as potentially disclosed for the full window regardless.

**Remediation performed:**

1. Scoped the exact blobs/commits via `git log --all -S'<row>' -- <path>` —
   confined to two commits (pre-rewrite hashes `3199a50af9`, `5495dde390`),
   two files.
2. `git filter-repo --replace-text` with an exact literal mapping from each
   real row (name, birthdate, pass number, filename, club name) to the
   project's standard synthetic fixture (`Max Testspieler` /
   `0100-0001` / `01.01.2014` / `FC Beispielstadt` etc.) — commits and
   messages preserved, only the affected file content at that point in
   history changed.
3. Verified post-rewrite: `check-pii-history.mjs` clean, `gitleaks` full
   history scan clean, all commits searched for the real name/pass-number
   strings return no hits, full test suite green.
4. Force-pushed the rewritten `main` (branch protection's "no force push"
   was temporarily disabled by the repo owner for this push, then
   re-enabled immediately after).
5. Deleted the local pre-rewrite clone that had been kept as a rollback
   backup, once the rewrite was verified — removing the last copy of the
   real data this session had access to.

**No credential rotation needed** (no secret/credential was involved).
**No GDPR Art. 33/34 controller notification assessment performed here** —
this is a developer-fixture incident involving a small number of players
from what appears to be the repo owner's own club context; the repo owner
should independently judge whether that club/association needs to be
informed, since only they have that relationship and context. This document
intentionally does not restate the real names/dates/pass numbers anywhere,
including in this incident record.

**Residual risk:** GitHub does not guarantee immediate garbage-collection of
unreachable objects after a force-push, and any clone or fork made during
the exposure window (none known) would retain the old objects regardless of
this rewrite. Treat the data as disclosed for the exposure window stated
above; this rewrite prevents further/future disclosure, it does not undo
past access.

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
