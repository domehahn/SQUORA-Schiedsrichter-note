export const PERMISSIONS = [
  "club.read", "club.manage", "members.read", "members.manage", "teams.read", "teams.manage",
  "players.read", "players.manage",
  // Pass number and birthdate are more sensitive than name/shirt number — a
  // role can list/see the roster (players.read) without seeing these two
  // fields unless it also carries this permission. See cloudflare/api/players.ts.
  "players.identity.read",
  "matches.read", "matches.create", "matches.update", "matches.delete",
  "tournaments.read", "tournaments.manage", "dfbnet.import", "dfbnet.read", "audit.read",
] as const;

export type Permission = typeof PERMISSIONS[number];

