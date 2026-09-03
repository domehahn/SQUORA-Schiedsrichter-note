# Current architecture baseline

Status: 2026-09-03, commit `3199a50` plus the preserved local lineup changes.

## Runtime

The application is a React 19/Vite PWA served by one Cloudflare Worker below
`squora.de/schiedsrichter-note/`. The Worker serves static assets, implements a
single-login form and exposes legacy synchronization endpoints. Vite's service
worker precaches static assets and uses `NetworkFirst` for navigations.

## Authentication and sessions

- Accounts are configured through `AUTH_EMAIL`, `AUTH_PASSWORD_HASH` and the
  optional `AUTH_USERS` secret instead of an authoritative user table.
- A successful PBKDF2 password check produces a signed, self-contained HMAC
  cookie valid for eight hours.
- Sessions cannot be individually enumerated or revoked. Disabling an account
  requires configuration changes; there is no account lifecycle.
- The cookie is HttpOnly, Secure and SameSite=Strict, but shares an origin with
  other applications under `squora.de`.

## Tenant and authorization model

- The browser creates arbitrary tenant IDs and uploads an unencrypted tenant
  index scoped only by the login e-mail.
- Data keys follow `note:<email>:t:<clientTenantId>` in KV.
- Any logged-in account can create, read, overwrite or delete any syntactically
  valid tenant ID within its own e-mail namespace. There is no server-side club,
  membership, role or permission record.
- Existing tests prove key separation and format validation, but not
  membership-based authorization or cross-user BOLA resistance.

This does not meet the required invariant. Encryption and a client-selected ID
are confidentiality aids, not an authorization boundary.

## Data and synchronization

- Cloudflare KV is the source of truth for one encrypted JSON blob per tenant.
- The blob contains current match, archive, deletion tombstones, tournaments and
  teams. Synchronization is last-write-wins and has no revision precondition.
- Decrypted domain data is copied to tenant-suffixed `localStorage` keys.
- The AES-GCM key is non-extractable and memory-only, derived with PBKDF2-SHA256,
  but the current cost is 210,000 iterations and the UI accepts six-character
  passphrases.
- JSON import is partially normalized after unrestricted `JSON.parse`; CSV
  export does not neutralize formula prefixes.

## DFBnet import

- Parsing lives directly under `src/dfbnet.ts` and is invoked from the React UI.
- The parser splits lines and delimiters without a complete CSV state machine.
- There is no staged preview/confirmation pipeline, schema contract,
  fingerprint, import audit record or bounded row/column/file policy.
- Birth dates and pass numbers are currently introduced by preserved local
  changes, although the target model explicitly forbids persisting them without
  a documented purpose.
- Committed tests contain data that appears to originate from a real youth-team
  export. It must be replaced and history treated as potentially exposed PII.

## Quality baseline

- Unit tests: 32 passing.
- Worker tests: 11 passing, with warnings for required test secrets.
- Build: passing.
- Lint: passing with one warning in preserved local work.
- Dependency audit: zero known vulnerabilities.
- Browser tests: 15 passing, one skipped, two failing because preserved lineup
  work changed `.roster-row` elements to table rows without updating the test.
- There is no CI workflow, D1 migration suite, Worker-backed browser suite,
  production readiness gate, backup rehearsal or rollback automation.

## Required transition

KV remains read-only legacy input during migration. D1 becomes authoritative for
users, clubs, memberships, domain records, sessions and audit events. Every
club-scoped repository call must receive a server-produced tenant context after
authentication, active-membership resolution and permission evaluation.

