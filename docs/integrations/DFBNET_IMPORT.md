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

## Status

Client pipeline and parser are implemented and unit-tested. The server-side
staged endpoint `POST /api/v1/clubs/:clubId/dfbnet/imports` with a
`dfbnet_imports` audit record (`DFBNET_IMPORT_STARTED/COMPLETED/FAILED`) is
**not yet built** — see `docs/EPIC_STATUS.md` (Epic 10).
