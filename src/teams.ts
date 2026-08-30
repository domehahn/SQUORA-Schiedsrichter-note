import { sanitizeRoster, uid, type Player } from "./match";

export interface SavedTeam {
  id: string;
  name: string;
  club: string;
  roster: Player[];
  updatedAt: string;
}

export function createSavedTeam(name = "", club = "", roster: Player[] = []): SavedTeam {
  return { id: uid(), name: name.trim(), club: club.trim(), roster, updatedAt: new Date().toISOString() };
}

export function sanitizeTeam(value: unknown): SavedTeam | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<SavedTeam> & Record<string, unknown>;
  if (typeof source.id !== "string" || !source.id) return null;
  return {
    id: source.id,
    name: String(source.name ?? "").slice(0, 80),
    club: String(source.club ?? "").slice(0, 80),
    roster: sanitizeRoster(source.roster),
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : new Date().toISOString(),
  };
}

export function sanitizeTeams(value: unknown): SavedTeam[] {
  if (!Array.isArray(value)) return [];
  return value.map(sanitizeTeam).filter((team): team is SavedTeam => team !== null);
}

export function mergeTeams(...lists: SavedTeam[][]): SavedTeam[] {
  const byId = new Map<string, SavedTeam>();
  for (const team of lists.flat()) {
    const current = byId.get(team.id);
    if (!current || team.updatedAt > current.updatedAt) byId.set(team.id, team);
  }
  return [...byId.values()].sort((a, b) => (a.name || a.club).localeCompare(b.name || b.club, "de"));
}
