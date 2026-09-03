# RBAC

Source of truth: `cloudflare/auth/roles.ts` and `cloudflare/auth/permissions.ts`.
Permission checks never use scattered string comparisons — every API handler
passes one `Permission` constant to `requireTenantAccess` / `requireTeamAccess`.

## Roles

| Role | Intent |
| --- | --- |
| `club_owner` | Created the club; full control incl. members and audit. |
| `club_admin` | Full control; typically delegated administration. |
| `referee_manager` | Runs match operations for the club: teams, players, matches, tournaments, DFBnet import. No member administration, no audit. |
| `referee` | Records matches: create/update matches, read teams/players/tournaments. Cannot delete matches or manage rosters. |
| `viewer` | Read-only across club data. |

## Permissions

`club.read`, `club.manage`,
`members.read`, `members.manage`,
`teams.read`, `teams.manage`,
`players.read`, `players.manage`,
`matches.read`, `matches.create`, `matches.update`, `matches.delete`,
`tournaments.read`, `tournaments.manage`,
`dfbnet.import`, `dfbnet.read`,
`audit.read`.

## Matrix

| Permission | owner | admin | ref-manager | referee | viewer |
| --- | :-: | :-: | :-: | :-: | :-: |
| club.read | ✓ | ✓ | ✓ | ✓ | ✓ |
| club.manage | ✓ | ✓ | | | |
| members.read | ✓ | ✓ | ✓ | | |
| members.manage | ✓ | ✓ | | | |
| teams.read | ✓ | ✓ | ✓ | ✓ | ✓ |
| teams.manage | ✓ | ✓ | ✓ | | |
| players.read | ✓ | ✓ | ✓ | ✓ | ✓ |
| players.manage | ✓ | ✓ | ✓ | | |
| matches.read | ✓ | ✓ | ✓ | ✓ | ✓ |
| matches.create | ✓ | ✓ | ✓ | ✓ | |
| matches.update | ✓ | ✓ | ✓ | ✓ | |
| matches.delete | ✓ | ✓ | ✓ | | |
| tournaments.read | ✓ | ✓ | ✓ | ✓ | ✓ |
| tournaments.manage | ✓ | ✓ | ✓ | | |
| dfbnet.import | ✓ | ✓ | ✓ | | |
| dfbnet.read | ✓ | ✓ | ✓ | ✓ | ✓ |
| audit.read | ✓ | ✓ | | | |

## Enforcement

- Unknown role on a membership → treated as no access (404).
- Has membership but lacks the permission → 403 `PERMISSION_DENIED`.
- No active membership → 404 `NOT_FOUND` (existence hidden).
- The whole-team sync endpoints require `matches.read` (GET) and
  `matches.update` (PUT); a `viewer` therefore cannot push team state.

## Tests

`cloudflare/test/tenant.test.ts` and `teams.test.ts` cover: viewer cannot
mutate, team-scoped `referee` cannot reach a sibling team, downgraded membership
loses access on the next request.
