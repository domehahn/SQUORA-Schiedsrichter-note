# Data export

## Purpose

Give a club a complete, portable copy of its data (GDPR portability; pre-deletion
safety net; migration between tools).

## Scope

One export = one club, requested by a member with `club.manage`, produced
server-side after the full authorization chain. Never spans clubs.

Included: club profile; teams; players; matches + match events; tournaments;
`dfbnet_imports` metadata; membership list (names + roles, no credentials);
audit log for the club (metadata only).

Excluded: password hashes, session tokens, encryption keys, other clubs' data,
raw DFBnet CSVs (never stored), private-note plaintext (only the opaque
ciphertext is included; it is useless without the club passphrase).

## Format

- `club.json` — structured tree of the above, stable schema, `schemaVersion`.
- `matches.csv`, `players.csv`, `events.csv` — spreadsheet-friendly, generated
  via `src/csv.ts` so `= + - @` cells are neutralised against formula injection.
- Delivered as one `.zip`, streamed, size-bounded.

## Controls

- `EXPORT_CREATED` audit row (requesting user, club, row counts) — Epic 18.
- Rate-limited per user and per club (Epic 28).
- Exports are generated on demand and not retained server-side.

## Status

Specified here; the `GET /api/v1/clubs/:clubId/export` endpoint is **not yet
implemented** (`docs/PRODUCTION_READINESS.md`). The client-side CSV/PDF export of
the locally held archive already exists and already applies CSV-injection
neutralisation.
