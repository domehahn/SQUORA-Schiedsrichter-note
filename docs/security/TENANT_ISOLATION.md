# Tenant isolation contract

Every club-scoped operation must execute this chain:

`session -> active user -> active membership -> permission -> tenant-scoped query`

The application must never derive authority from a club ID in frontend state,
browser storage, a URL, a JSON body, encryption possession or a naming convention.

Repositories accept a server-created tenant context and bind `club_id` in the
same statement used to read or mutate an entity. Cross-tenant entity references
are additionally rejected by composite primary/foreign keys. Foreign and missing
objects return the same 404 response where existence would otherwise leak.

Tenant isolation tests are mandatory merge gates for read, create, update,
delete, import and export. They also cover disabled accounts, suspended/removed
memberships and every role.

