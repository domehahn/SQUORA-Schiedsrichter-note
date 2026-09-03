# ADR-001 — Encryption model

- Status: accepted
- Date: 2026-09-03
- Deciders: architecture / security

## Context

SQUORA stores club structure, teams, players, matches, match events,
tournaments and DFBnet-derived roster data, plus private referee notes. Some of
this is `SENSITIVE_PERSONAL` and may concern minors (see
`docs/security/DATA_CLASSIFICATION.md`). The product must be a real multi-tenant
SaaS with server-verified tenant isolation, auditability, backup/restore and
GDPR data-subject workflows.

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

All entities live in D1 with RBAC; rely on Cloudflare D1 encryption at rest.

- Pro: every required control (Epics 3–5, 15–22, 41–47) is straightforward.
- Con: an unlocked session or a server compromise exposes private referee
  notes, which have no operational need to be server-readable.

### Model C — hybrid (chosen)

```
Club structure, teams, players, matches, match events,
tournaments, DFBnet-derived rosters
        -> D1 + server-side authorization (RBAC) + platform encryption at rest

Private referee notes / incident notes
        -> optional client-side AES-256-GCM, key derived from a per-club
           passphrase, stored as an opaque ciphertext column

Offline cache (whole-team snapshot in the browser)
        -> always AES-256-GCM in IndexedDB, key in memory only
```

## Decision

Adopt **Model C**.

1. **Authoritative data is relational and server-authorized.** No entity's
   tenant isolation depends on encryption. `requireTenantAccess` /
   `requireTeamAccess` resolve an active membership and permission before any
   query; composite keys make cross-tenant references impossible in the DB.

2. **Private notes are optionally E2E-encrypted.** `matches.private_notes_ciphertext`
   (and equivalents) hold an opaque blob the server never decrypts, indexes or
   logs. Losing the passphrase loses only the notes, not the match record.

3. **The offline cache is always encrypted.** The browser holds one
   per-`(club, team)` snapshot in IndexedDB (`encryptedCache.ts`), AES-256-GCM,
   key derived with PBKDF2-HMAC-SHA256 (≥ 600 000 iterations, ≥ 128-bit salt),
   non-extractable, kept in memory only — never `localStorage`, `sessionStorage`,
   logs, D1 or KV. Passphrase minimum 12 characters, no maximum.

4. **DFBnet minimization is independent of encryption.** Birth date, pass
   number, nationality and eligibility are stripped server-side
   (`FORBIDDEN_DFBNET_FIELDS`) regardless of transport encryption.

## Consequences

- Server compromise exposes authoritative club data (mitigated by platform
  encryption at rest, EU jurisdiction, least-privilege account access) but not
  private notes.
- Backup/restore, audit, export and deletion operate on cleartext D1 rows and
  work normally; private-note ciphertext is backed up and restored opaquely.
- The client must handle "notes locked" (no passphrase this session) as a normal
  state.
- If a future requirement needs server-side search over notes, this ADR must be
  revisited rather than silently weakened.
