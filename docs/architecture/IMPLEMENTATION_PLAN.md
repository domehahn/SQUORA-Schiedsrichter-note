# Production-readiness implementation plan

## Dependency order

1. Sanitize test PII and establish security documentation.
2. Add D1 schema, constraints and isolated development/staging/production
   bindings.
3. Replace configured production users and signed bearer-like cookies with D1
   users and hashed, revocable server sessions.
4. Introduce centralized roles, permissions, authentication, tenant resolution
   and repositories. Add two-user/two-club isolation tests before domain APIs.
5. Add versioned `/api/v1` club, member, team, player, match, tournament, import,
   audit, export and deletion routes. All foreign identifiers are resolved with
   `club_id` in the same query and foreign resources return 404.
6. Move production to `schiri.squora.de`, scope cookies and PWA caches to that
   origin, and make every `/api/*` and `/auth/*` request NetworkOnly.
7. Replace plaintext localStorage domain data with an encrypted IndexedDB cache;
   keep encryption keys in memory only and raise the local KDF/passphrase floor.
8. Split the DFBnet adapter into parser/schema/mapper/validator/fingerprint
   modules, apply minimization and limits, then persist confirmed imports only.
9. Add audit, structured request logs, optimistic locking, strict import/export,
   retention/deletion flows and controlled legacy KV migration.
10. Add CI/security gates, Worker+D1 browser tests, environment/deployment
    automation, backup/restore and incident/rollback runbooks. Deploy production
    only after the readiness checklist is evidenced.

## Non-negotiable test gate

For every club-scoped resource and action, tests create User A/Club A and User
B/Club B and attempt read, update, delete, export and import with manipulated
club and entity IDs. Access to foreign resources must be indistinguishable from
absence (404). Revoked memberships and disabled users must fail immediately;
viewers must never mutate and referees must never administer memberships.

## Migration safety

Legacy KV records are never trusted solely because their key contains an e-mail
or client tenant ID. Migration requires an authenticated owner, an explicit
legacy-to-club mapping, validation and an auditable idempotency fingerprint.
Successful verification marks a record migrated; it does not delete the source.

