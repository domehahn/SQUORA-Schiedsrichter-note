# ADR-001 — Encryption model

- Status: accepted (target Model C; **current implementation is Model B for all
  server-side data, plus the encrypted offline cache**)
- Date: 2026-09-03, revised 2026-09-04
- Deciders: architecture / security

## Context

SQUORA stores club structure, teams, players, matches, match events,
tournaments and DFBnet-derived roster data, plus free-text referee notes and
incident descriptions. Some of this is `SENSITIVE_PERSONAL` and may concern
minors (see `docs/security/DATA_CLASSIFICATION.md`). The product must be a real
multi-tenant SaaS with server-verified tenant isolation, auditability,
backup/restore and GDPR data-subject workflows.

Three models were considered.

### Model A — full end-to-end encryption

The server stores only ciphertext; keys never leave the browser.

- Pro: strongest confidentiality against a server compromise.
- Con: server-side authorization, RBAC, cross-tenant constraints, audit,
  pagination, admin export/delete and backup verification all become
  impossible or must be re-implemented client-side without a trust anchor.
  A lost passphrase means permanent data loss. Incompatible with the
  non-negotiable invariant "no request may act without server-verified
  club authorization".

### Model B — server-side SaaS data, platform encryption at rest

All entities live in D1 with RBAC; rely on Cloudflare D1 encryption at rest and
the EU jurisdiction pin.

- Pro: every required control (Epics 3–5, 15–22, 41–47) is straightforward.
- Con: an unlocked session or a server compromise exposes referee notes and
  incident text along with the rest of the match record.

### Model C — hybrid (target)

```
Club structure, teams, players, matches, match events,
tournaments, DFBnet-derived rosters
        -> D1 + server-side authorization (RBAC) + platform encryption at rest

Free-text referee notes / incident text
        -> OPTIONAL client-side AES-256-GCM into a dedicated opaque column
           the server never reads (matches.private_notes_ciphertext)

Offline cache (whole-team snapshot in the browser)
        -> always AES-256-GCM in IndexedDB, key in memory only
```

## Decision

Adopt **Model B now**, with **Model C as the sanctioned target** for free-text
notes only.

1. **Authoritative data is relational and server-authorized.** No entity's
   tenant isolation depends on encryption. `requireTenantAccess` /
   `requireTeamAccess` resolve an active membership and permission before any
   query; composite keys make cross-tenant references impossible in the DB.

2. **The offline cache is always encrypted (implemented).** The browser holds
   one per-`(userId, club, team)` snapshot in IndexedDB (`encryptedCache.ts`),
   AES-256-GCM, key derived with PBKDF2-HMAC-SHA256 (≥ 600 000 iterations,
   ≥ 128-bit salt), non-extractable, kept in memory only — never
   `localStorage`, `sessionStorage`, logs, D1 or KV. Passphrase minimum 12
   characters, no maximum. This is a per-device confidentiality aid, never an
   authorization boundary.

3. **DFBnet minimization is independent of encryption (implemented).**
   Nationality, eligibility/`Spielrecht` and registration dates are stripped
   server-side at every depth. Pass number and birth date are retained **only**
   on the referee's own-team relational roster (`players`) for the passport /
   eligibility check (product decision 2026-09-04, purpose + legal basis in
   `docs/privacy/DFBNET_DATA_HANDLING.md`); the birth date never enters the
   `/state` sync blob. This is orthogonal to transport encryption.

4. **Client-side E2E of free-text notes is NOT yet implemented.** Today, notes
   and incident text travel inside `matches.payload_json` / the team-state blob
   and are **server-readable**, protected only by Model B (D1 encryption at
   rest, RBAC, EU jurisdiction, least-privilege account access, no note content
   in logs or audit metadata). `matches.private_notes_ciphertext` exists as a
   **reserved, currently-unused** column for the future opt-in feature; no code
   writes or reads it.

## Current state vs. target

| Data | Model in effect today | Target |
| --- | --- | --- |
| Clubs, teams, players, matches, events, tournaments, rosters | B | B |
| Free-text referee/incident notes | **B** (server-readable) | C (opt-in client-side E2E) |
| Browser offline cache | C (always encrypted) | C |

## Consequences

- A server compromise or a misused privileged session currently exposes note
  text along with the match record. Until step 4 ships, notes must be treated as
  `SENSITIVE_PERSONAL` data under Model B, and the UI must not promise
  end-to-end confidentiality for them.
- Backup/restore, audit, export and deletion operate on cleartext D1 rows and
  work normally.
- When step 4 is implemented it must add: a separate note key (not the offline
  cache key), a "notes locked" UI state, and export/delete handling that treats
  the ciphertext column opaquely.
- If a future requirement needs server-side search over notes, Model C step 4 is
  off the table and this ADR must be revisited.
