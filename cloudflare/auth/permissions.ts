export const PERMISSIONS = [
  "club.read", "club.manage", "members.read", "members.manage", "teams.read", "teams.manage",
  "players.read", "players.manage", "matches.read", "matches.create", "matches.update", "matches.delete",
  "tournaments.read", "tournaments.manage", "dfbnet.import", "dfbnet.read", "audit.read",
] as const;

export type Permission = typeof PERMISSIONS[number];

