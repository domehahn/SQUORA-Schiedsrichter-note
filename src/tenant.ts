export type Role = "club_owner" | "club_admin" | "referee_manager" | "referee" | "viewer";

export interface TenantMeta {
  id: string;
  name: string;
  slug: string;
  cacheSalt: string;
  role: Role;
  permissions: string[];
}

export function isTenantMeta(value: unknown): value is TenantMeta {
  const club = value as Partial<TenantMeta> | undefined;
  return Boolean(club && typeof club.id === "string" && typeof club.name === "string" && typeof club.slug === "string" && typeof club.cacheSalt === "string" && typeof club.role === "string" && Array.isArray(club.permissions));
}

/** A team (Jugend/Mannschaft) within a club — the actual data-isolation unit. */
export interface TeamUnit {
  id: string;
  name: string;
  ageGroup: string | null;
}

export function isTeamUnit(value: unknown): value is TeamUnit {
  const team = value as Partial<TeamUnit> | undefined;
  return Boolean(team && typeof team.id === "string" && typeof team.name === "string");
}

/** Stable id for the per-(club, team) encrypted cache + remembered-selection storage. */
export function scopeKey(clubId: string, teamId: string): string {
  return `${clubId}:${teamId}`;
}

