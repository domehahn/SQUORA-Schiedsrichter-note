# DFBnet roster import

DFBnet is decoupled from the UI behind `src/integrations/dfbnet/`. The React
layer knows only `RosterProvider` and the domain `Player` type — never DFBnet
column names.

## Modules

| Module | Responsibility |
| --- | --- |
| `parser.ts` | RFC-4180-style CSV state machine: quoted fields, separators and newlines inside quotes, escaped quotes (`""`), CRLF, UTF-8 BOM, delimiter auto-detection (`;` `,` tab), empty fields. |
| `schema.ts` | `ALLOWED_DFBNET_FIELDS`, `LOCAL_ONLY_DFBNET_FIELDS`, `DFBNET_LIMITS`, `detectSchema()` header/column detection. |
| `validator.ts` | `validateFile` (size, non-empty, filename) and `validateTable` (row/column/field-length caps) → `DfbnetValidationError` codes. |
| `mapper.ts` | `ExternalPlayer[]` → normalised rows; control-char scrubbing; trims to whitelist. |
| `fingerprint.ts` | Stable content hash for idempotency / duplicate-import detection. |
| `provider.ts` | `DfbnetCsvProvider implements RosterProvider`; future `FootballDeProvider`, `GenericCsvProvider`, `ManualProvider`. |
| `types.ts` | `ExternalPlayer`, `ExternalRoster`, `RosterProvider`. |

## Pipeline

```
upload → validateFile → parse (delimiter detect, BOM strip)
       → validateTable → detectSchema → map to ExternalPlayer[]
       → minimize (whitelist) → preview → user confirmation → import
```

`import` writes into the caller's authorized `(club, team)` roster only.
Birth date / pass number, if present, are surfaced for the referee and stored
**only** in the encrypted local cache; the server strips them
(`FORBIDDEN_DFBNET_FIELDS`). The original CSV is never stored or logged.

## Limits (`DFBNET_LIMITS`)

file ≤ 2 MB · rows ≤ 5000 · columns ≤ 100 · field ≤ 2000 chars · filename ≤ 255 ·
parse ≤ 1500 ms. Values are centralised; change them there only.

## Server-side staged endpoint

`cloudflare/api/dfbnet.ts`, all under `/api/v1/clubs/:c/teams/:t/dfbnet/imports`:

| Method / path | Permission | Behaviour |
| --- | --- | --- |
| `POST .../imports` | `dfbnet.import` | Re-validates the minimized roster, re-strips forbidden fields, computes a team-scoped SHA-256 fingerprint, writes a `dfbnet_imports` row (`previewed`). Body `confirm: true` also applies in one call. Duplicate fingerprint of a completed import → returns it, no new row. |
| `POST .../imports/:id/confirm` | `dfbnet.import` | Applies a previewed import; the roster is resent and must fingerprint-match (else 422 `PAYLOAD_MISMATCH`). |
| `GET .../imports` | `dfbnet.read` | Team-scoped history, metadata only. |

Player upsert is idempotent: by `externalId` (`ON CONFLICT`) or by name when
absent; `version` bumps on change. Audit: `DFBNET_IMPORT_STARTED / _COMPLETED /
_FAILED`. Rate-limited via `IMPORT_RATE_LIMITER` (20/60s) keyed by
IP + account + tenant + endpoint. Migration `0014` adds `dfbnet_imports.team_id`.
Tests: `cloudflare/test/dfbnet.test.ts`.
