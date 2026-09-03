# Threat model

## Protected assets

Accounts, memberships, club structure, player and match data, private notes,
DFBnet imports, session tokens, encryption keys and audit evidence.

## Trust boundaries

The browser, URLs, request bodies, identifiers, local databases, service-worker
caches and imported files are untrusted. Only a validated D1 session followed by
an active D1 membership and explicit permission creates authority. D1 queries
and composite constraints form the final tenant boundary.

## Principal threats and controls

- BOLA/IDOR and cross-tenant leakage: centralized tenant resolver, club-scoped
  repositories, composite keys/foreign keys and adversarial two-tenant tests.
- SQL injection: parameterized D1 statements and strict identifier/value
  validation.
- XSS/CSRF/session theft or fixation: restrictive CSP, output-safe React,
  same-origin validation, Strict HttpOnly cookies, random rotated session tokens,
  server-side revocation and no sensitive caches.
- Credential stuffing/brute force: generic errors and endpoint, account and IP
  rate limits without logging credentials.
- Malicious CSV/JSON: size, row, column, field and time limits; robust parsing;
  schema whitelist; preview and explicit confirmation; formula neutralization on
  export.
- Resource exhaustion: bounded payloads, pagination and import budgets.
- Stale or stolen browsers: short/revocable sessions, membership checks on every
  request, encrypted IndexedDB and memory-only cache keys.
- Malicious members/privilege escalation: deny-by-default RBAC and audited
  membership/role changes.
- Deleted membership retaining access: membership resolution per request, never
  a long-lived role claim in the cookie.
- Service-worker leakage: NetworkOnly for `/api/*` and `/auth/*`; no HTML shell
  containing user data.

Residual risks and operational controls are tracked in
`SECURITY_ASSUMPTIONS.md` and the production-readiness checklist.

