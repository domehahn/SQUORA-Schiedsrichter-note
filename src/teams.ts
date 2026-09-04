import { sanitizeRoster, uid, type Player } from "./match";

/**
 * `kind` splits the library:
 *  - `opponent` (default) — an editable team, mostly the opposition; kept for reuse.
 *  - `roster` — a read-only snapshot of "Mein Kader" (written on DFBnet import).
 *  - `lineup` — a read-only saved match lineup (start / bench / not nominated).
 * `roster` and `lineup` entries form the history; they are never edited in place.
 */
export type SavedTeamKind = "opponent" | "roster" | "lineup";

export interface SavedTeam {
  id: string;
  name: string;
  club: string;
  roster: Player[];
  updatedAt: string;
  kind?: SavedTeamKind;
  savedAt?: string;
  opponent?: string;
  matchDate?: string;
}

export function createSavedTeam(name = "", club = "", roster: Player[] = []): SavedTeam {
  return { id: uid(), name: name.trim(), club: club.trim(), roster, updatedAt: new Date().toISOString() };
}

export function createHistoryEntry(kind: "roster" | "lineup", name: string, roster: Player[], extra: { opponent?: string; matchDate?: string } = {}): SavedTeam {
  const now = new Date().toISOString();
  return { id: uid(), name: name.trim().slice(0, 80), club: "", roster, updatedAt: now, kind, savedAt: now, ...extra };
}

export function isHistory(team: SavedTeam): boolean {
  return team.kind === "roster" || team.kind === "lineup";
}

export function sanitizeTeam(value: unknown): SavedTeam | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<SavedTeam> & Record<string, unknown>;
  if (typeof source.id !== "string" || !source.id) return null;
  const kind = source.kind === "roster" || source.kind === "lineup" ? source.kind : source.kind === "opponent" ? "opponent" : undefined;
  return {
    id: source.id,
    name: String(source.name ?? "").slice(0, 80),
    club: String(source.club ?? "").slice(0, 80),
    roster: sanitizeRoster(source.roster),
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : new Date().toISOString(),
    ...(kind ? { kind } : {}),
    ...(typeof source.savedAt === "string" ? { savedAt: source.savedAt } : {}),
    ...(typeof source.opponent === "string" ? { opponent: String(source.opponent).slice(0, 80) } : {}),
    ...(typeof source.matchDate === "string" ? { matchDate: String(source.matchDate).slice(0, 40) } : {}),
  };
}

export function sanitizeTeams(value: unknown): SavedTeam[] {
  if (!Array.isArray(value)) return [];
  return value.map(sanitizeTeam).filter((team): team is SavedTeam => team !== null).slice(0, 400);
}

export function mergeTeams(...lists: SavedTeam[][]): SavedTeam[] {
  const byId = new Map<string, SavedTeam>();
  for (const team of lists.flat()) {
    const current = byId.get(team.id);
    if (!current || team.updatedAt > current.updatedAt) byId.set(team.id, team);
  }
  return [...byId.values()].sort((a, b) => {
    if (isHistory(a) !== isHistory(b)) return isHistory(a) ? 1 : -1; // opponents first, history after
    if (isHistory(a)) return (b.savedAt ?? b.updatedAt).localeCompare(a.savedAt ?? a.updatedAt); // newest history first
    return (a.name || a.club).localeCompare(b.name || b.club, "de");
  });
}
