import { normalizeMatch, type MatchState, type SavedMatch } from "./match";
import { sanitizeTournaments, type Tournament } from "./tournament";
import { sanitizeTeams, type SavedTeam } from "./teams";
import { isTeamUnit, isTenantMeta, type TeamUnit, type TenantMeta } from "./tenant";

const BASE = import.meta.env.BASE_URL ?? "/";
const API = `${BASE}api/v1`;
const enc = encodeURIComponent;
const teamsUrl = (clubId: string) => `${API}/clubs/${enc(clubId)}/teams`;
const stateUrl = (clubId: string, teamId: string) => `${API}/clubs/${enc(clubId)}/teams/${enc(teamId)}/state`;
const versions = new Map<string, number>();

export type SyncState = "idle" | "syncing" | "synced" | "offline" | "error" | "conflict";

export interface CloudData {
  archive: SavedMatch[];
  deletedIds: string[];
  tournaments: Tournament[];
  teams: SavedTeam[];
  current: MatchState | null;
}

export function emptyCloudData(): CloudData {
  return { archive: [], deletedIds: [], tournaments: [], teams: [], current: null };
}

function isSavedMatch(value: unknown): value is SavedMatch {
  const entry = value as SavedMatch | undefined;
  return Boolean(entry && typeof entry.savedAt === "string" && entry.state && typeof entry.state === "object");
}

export function sanitizeArchive(value: unknown): SavedMatch[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isSavedMatch).map((entry) => ({ savedAt: entry.savedAt, state: normalizeMatch(entry.state) }));
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 5000) : [];
}

export function parseCloudData(value: unknown): CloudData {
  const data = (value ?? {}) as Record<string, unknown>;
  return {
    archive: sanitizeArchive(data.archive),
    deletedIds: toStringArray(data.deletedIds),
    tournaments: sanitizeTournaments(data.tournaments),
    teams: sanitizeTeams(data.teams),
    current: data.current ? normalizeMatch(data.current) : null,
  };
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

export async function fetchMe(): Promise<{ userId: string; displayName: string } | null> {
  try {
    const response = await fetch(`${API}/me`, { headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    const body = await response.json() as { user?: { id?: unknown; displayName?: unknown } };
    return typeof body.user?.id === "string"
      ? { userId: body.user.id, displayName: typeof body.user.displayName === "string" ? body.user.displayName : "" }
      : null;
  } catch { return null; }
}

export async function fetchTenantIndex(): Promise<TenantMeta[] | null> {
  try {
    const response = await fetch(`${API}/clubs`, { headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    const body = await response.json() as { clubs?: unknown };
    return Array.isArray(body.clubs) ? body.clubs.filter(isTenantMeta) : [];
  } catch { return null; }
}

export async function createTenant(name: string): Promise<TenantMeta | null> {
  try {
    const response = await fetch(`${API}/clubs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    if (!response.ok) return null;
    const body = await response.json() as { club?: unknown };
    return isTenantMeta(body.club) ? body.club : null;
  } catch { return null; }
}

export async function fetchTeams(clubId: string): Promise<TeamUnit[] | null> {
  try {
    const response = await fetch(teamsUrl(clubId), { headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    const body = await response.json() as { teams?: unknown };
    return Array.isArray(body.teams) ? body.teams.filter(isTeamUnit) : [];
  } catch { return null; }
}

export async function createTeamUnit(clubId: string, name: string, ageGroup: string | null): Promise<TeamUnit | null> {
  try {
    const response = await fetch(teamsUrl(clubId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, ...(ageGroup ? { ageGroup } : {}) }) });
    if (!response.ok) return null;
    const body = await response.json() as { team?: unknown };
    return isTeamUnit(body.team) ? body.team : null;
  } catch { return null; }
}

export type TenantFetch = { ok: true; data: CloudData } | { ok: false; reason: "empty" | "offline" | "decrypt" | "unauthorized" };

export async function fetchTenantData(clubId: string, teamId: string, _key?: CryptoKey | null): Promise<TenantFetch> {
  const scope = `${clubId}:${teamId}`;
  try {
    const response = await fetch(stateUrl(clubId, teamId), { headers: { Accept: "application/json" } });
    if (response.status === 401 || response.status === 403 || response.status === 404) return { ok: false, reason: "unauthorized" };
    if (!response.ok) return { ok: false, reason: "offline" };
    const body = await response.json() as Record<string, unknown>;
    versions.set(scope, typeof body.version === "number" ? body.version : 0);
    return { ok: true, data: parseCloudData(body) };
  } catch { return { ok: false, reason: "offline" }; }
}

export async function pushTenantData(clubId: string, teamId: string, _key: CryptoKey | null, data: CloudData): Promise<boolean> {
  const scope = `${clubId}:${teamId}`;
  try {
    const response = await fetch(stateUrl(clubId, teamId), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: versions.get(scope) ?? 0, ...data }),
    });
    if (response.status === 409) return false;
    if (!response.ok) return false;
    const body = await response.json() as { version?: unknown };
    if (typeof body.version === "number") versions.set(scope, body.version);
    return true;
  } catch { return false; }
}

/** Read-only legacy source; migration requires explicit user mapping in the UI. */
export async function fetchLegacy(): Promise<CloudData | null> {
  try {
    const response = await fetch(`${BASE}api/archive`, { headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    const data = parseCloudData(await response.json());
    return data.archive.length || data.tournaments.length || data.teams.length || data.current ? data : null;
  } catch { return null; }
}
