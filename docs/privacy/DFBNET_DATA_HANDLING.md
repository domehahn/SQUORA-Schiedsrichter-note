# DFBnet data handling

DFBnet roster exports frequently contain more than SQUORA needs, including data
about minors: birth dates, pass numbers, nationality, eligibility/`Spielrecht`,
registration dates, DFBnet person ids, sometimes contact data.

## Purpose & legal basis (product decision 2026-09-04)

A match referee is responsible for checking player identity and eligibility at
the ground — for youth football this includes the age class. SQUORA therefore
stores, **for the referee's own team only**, two additional identity fields:

| Field | Purpose |
| --- | --- |
| `pass_number` | player pass / ID check at the ground |
| `birthdate` | age-class / eligibility (`Spielberechtigung`) check |

Legal basis: Art. 6(1)(f) GDPR — the legitimate interest of the referee and the
association in a correctly staffed, rule-compliant match. Data is minimised to
these two fields; nationality, `Spielrecht` text and registration dates are
**never** stored. A minor-data assessment is recorded in `ADR-001`.

## Rules

1. **No official interface is assumed.** Input is an operator-supplied CSV and is
   treated as adversarial (`docs/security/SECURITY_ASSUMPTIONS.md`).
2. **The original file is never persisted or logged.** It is parsed in memory
   for preview; only the outcome is kept. Source encoding (UTF-8 or
   Windows-1252) is detected so umlauts survive; the raw bytes are discarded.
3. **Two whitelists, server-enforced** (`cloudflare/core/dfbnet.ts`):
   * **Own-team relational roster** (`players`, staged `/dfbnet/imports`):
     `name`, `firstName`, `shirtNumber`, `externalId`, `passNumber`, `birthdate`.
   * **`/state` sync blob** (opponent library, match lineups):
     `name`, `firstName`, `shirtNumber`, `externalId`, `pass`. The **birthdate is
     stripped** — it only ever lives on the `players` table.
4. **Always stripped, everywhere, at every nesting depth:** `nationality` /
   `nationalität`, `eligibility` / `spielrecht`, `registrationdate`. The server
   re-minimises every payload even though the client already filtered — the
   client filter is UX only, the server is the trust boundary.
5. **Birthdate never leaves "Mein Kader".** Copying a roster from "Mein Kader"
   into the team library or a match lineup carries name + shirt number + pass
   number only. The pass number does reach the `/state` blob and the match
   archive by the decision above; the birthdate does not.
6. **Import metadata only.** `dfbnet_imports` stores filename, a content
   fingerprint (for idempotency/dedup), row/column counts, status and an error
   summary — never cell contents, never identity fields.
7. **Limits.** File ≤ 2 MB, ≤ 5000 rows, ≤ 100 columns, bounded field length and
   parse time (`DFBNET_LIMITS`). Oversized input is rejected before parsing
   completes. The staged import is rate-limited (`IMPORT_RATE_LIMITER`).
8. **Tenant scoping.** A confirmed import writes only to the caller's authorized
   `(club, team)`; it can never overwrite another club's or team's roster.
9. **Birthdate format.** Accepted as `TT.MM.JJJJ` (DFBnet) or `YYYY-MM-DD`; any
   other shape is rejected (422). Stored verbatim, never parsed into an age.

## Privacy-by-design questions (answered for each imported field)

| Field | Stored? | Why | Who sees it | Retention |
| --- | --- | --- | --- | --- |
| name, firstName | yes (D1 `players` + `/state` blob) | identify players on the sheet | club members with `players.read` | with the roster (season + 2) |
| shirtNumber | yes | match the sheet to the pitch | same | same |
| externalId | yes (`players`) | dedupe re-imports | same | same |
| passNumber | yes — `players` **and** `/state` blob / match archive | referee ID check at the ground; belongs on the match sheet | club members with `players.read` / `matches.read` | with the roster / match (season + 2) |
| birthdate | **`players` only** (own team) | age-class / eligibility check | club members with `players.read` for that team | cleared when the player is removed; deleted with the team/club |
| nationality, eligibility, registrationDate, DFBnet person text | no | no operational need | — | — |

## If a real integration becomes available

Revisit this document and `ADR-001`. Any new persisted field needs a documented
purpose, an audience, a retention window and a minor-data assessment before
implementation.
