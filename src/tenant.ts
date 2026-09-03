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

