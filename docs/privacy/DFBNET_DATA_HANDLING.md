# DFBnet data handling

DFBnet roster exports frequently contain more than SQUORA needs, including data
about minors: birth dates, pass numbers, nationality, eligibility/`Spielrecht`,
registration dates, DFBnet person ids, sometimes contact data.

## Rules

1. **No official interface is assumed.** Input is an operator-supplied CSV and is
   treated as adversarial (`docs/security/SECURITY_ASSUMPTIONS.md`).
2. **The original file is never persisted or logged.** It is parsed in memory
   for preview; only the outcome is kept.
3. **Field whitelist.** Only `name`, `firstName`, `shirtNumber`, `externalId`
   may enter the domain model (`src/integrations/dfbnet/schema.ts`).
4. **Forbidden fields are stripped server-side too.** `api/state.ts`
   `FORBIDDEN_DFBNET_FIELDS` removes `birthdate/geburtsdatum`, `pass/passnummer`,
   `nationality/nationalität`, `eligibility/spielrecht`, `registrationdate` from
   any synced payload, at every nesting depth — defence in depth behind the
   client whitelist.
5. **Local-only exception.** Birth date and pass number can be shown and edited
   in the referee's own roster UI and stored **only** in the encrypted local
   cache. They are stripped before anything reaches D1/KV. There is no server
   record of them.
6. **Import metadata only.** `dfbnet_imports` stores filename, a content
   fingerprint (for idempotency/dedup), row/column counts, status and an error
   summary — never cell contents.
7. **Limits.** File ≤ 2 MB, ≤ 5000 rows, ≤ 100 columns, bounded field length and
   parse time (`DFBNET_LIMITS`). Oversized input is rejected before parsing
   completes.
8. **Tenant scoping.** A confirmed import writes only to the caller's authorized
   `(club, team)`; it can never overwrite another club's or team's roster.

## Privacy-by-design questions (answered for each imported field)

| Field | Stored? | Why | Who sees it | Retention |
| --- | --- | --- | --- | --- |
| name, firstName | yes (D1 `players` / local roster) | identify players on the sheet | club members with `players.read` | season + 2 |
| shirtNumber | yes | match the sheet to the pitch | same | season + 2 |
| externalId | yes | dedupe re-imports | same | season + 2 |
| birthdate | local cache only | age-class plausibility for the referee | only that referee's browser | until lock/logout |
| passnummer | local cache only | referee ID check at the ground | only that referee's browser | until lock/logout |
| nationality, eligibility, registrationDate, DFBnet person id | no | no operational need | — | — |

## If a real integration becomes available

Revisit this document and `ADR-001`. Any new persisted field needs a documented
purpose, an audience, a retention window and a minor-data assessment before
implementation.
