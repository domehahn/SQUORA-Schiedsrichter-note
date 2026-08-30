import { normalizeMatch, type MatchState, type SavedMatch } from "./match";
import { sanitizeTournaments, type Tournament } from "./tournament";
import { sanitizeTeams, type SavedTeam } from "./teams";

const API_URL = `${import.meta.env.BASE_URL ?? "/"}api/archive`;

export type SyncState = "idle" | "syncing" | "synced" | "offline" | "error";

export interface CloudData {
  archive: SavedMatch[];
  deletedIds: string[];
  tournaments: Tournament[];
  teams: SavedTeam[];
  current: MatchState | null;
}

export interface RemotePayload extends CloudData {
  updatedAt: string | null;
}

function isSavedMatch(value: unknown): value is SavedMatch {
  const entry = value as SavedMatch | undefined;
  return Boolean(entry && typeof entry.savedAt === "string" && entry.state && typeof entry.state === "object");
}

export function sanitizeArchive(value: unknown): SavedMatch[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isSavedMatch).map((entry) => ({ savedAt: entry.savedAt, state: normalizeMatch(entry.state) }));
}

export function mergeArchives(...lists: SavedMatch[][]): SavedMatch[] {
  const byId = new Map<string, SavedMatch>();
  for (const entry of lists.flat()) {
    const current = byId.get(entry.state.id);
    if (!current || entry.savedAt > current.savedAt) byId.set(entry.state.id, entry);
  }
  return [...byId.values()].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function applyDeletions(archive: SavedMatch[], deletedIds: Iterable<string>): SavedMatch[] {
  const removed = new Set(deletedIds);
  return archive.filter((entry) => !removed.has(entry.state.id));
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export async function fetchRemote(): Promise<RemotePayload | null> {
  try {
    const response = await fetch(API_URL, { headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    const data = (await response.json()) as Record<string, unknown>;
    return {
      updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : null,
      archive: sanitizeArchive(data.archive),
      deletedIds: toStringArray(data.deletedIds),
      tournaments: sanitizeTournaments(data.tournaments),
      teams: sanitizeTeams(data.teams),
      current: data.current ? normalizeMatch(data.current) : null,
    };
  } catch {
    return null;
  }
}

export async function pushRemote(data: CloudData): Promise<boolean> {
  try {
    const response = await fetch(API_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        archive: data.archive,
        deletedIds: data.deletedIds,
        tournaments: data.tournaments,
        teams: data.teams,
        current: data.current,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
