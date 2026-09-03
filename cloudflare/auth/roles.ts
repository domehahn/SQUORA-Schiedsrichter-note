import type { Permission } from "./permissions";

export type Role = "club_owner" | "club_admin" | "referee_manager" | "referee" | "viewer";

const all: Permission[] = [
  "club.read", "club.manage", "members.read", "members.manage", "teams.read", "teams.manage",
  "players.read", "players.manage", "matches.read", "matches.create", "matches.update", "matches.delete",
  "tournaments.read", "tournaments.manage", "dfbnet.import", "dfbnet.read", "audit.read",
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  club_owner: all,
  club_admin: all,
  referee_manager: ["club.read", "members.read", "teams.read", "teams.manage", "players.read", "players.manage", "matches.read", "matches.create", "matches.update", "matches.delete", "tournaments.read", "tournaments.manage", "dfbnet.import", "dfbnet.read"],
  referee: ["club.read", "teams.read", "players.read", "matches.read", "matches.create", "matches.update", "tournaments.read", "dfbnet.read"],
  viewer: ["club.read", "teams.read", "players.read", "matches.read", "tournaments.read", "dfbnet.read"],
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && Object.hasOwn(ROLE_PERMISSIONS, value);
}

