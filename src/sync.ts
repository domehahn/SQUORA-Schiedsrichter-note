import { decryptString, encryptString } from "./crypto";
import { normalizeMatch, type MatchState, type SavedMatch } from "./match";
import { sanitizeTournaments, type Tournament } from "./tournament";
import { sanitizeTeams, type SavedTeam } from "./teams";
import { sanitizeTenantIndex, type TenantIndex } from "./tenant";

const BASE = import.meta.env.BASE_URL ?? "/";
const TENANTS_URL = `${BASE}api/tenants`;
const LEGACY_URL = `${BASE}api/archive`;
const tenantDataUrl = (id: string) => `${BASE}api/tenant/${encodeURIComponent(id)}`;

export type SyncState = "idle" | "syncing" | "synced" | "offline" | "error";

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
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
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

function serializeCloudData(data: CloudData): string {
  return JSON.stringify({
    archive: data.archive,
    deletedIds: data.deletedIds,
    tournaments: data.tournaments,
    teams: data.teams,
    current: data.current,
  });
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

// --- Tenant index (unencrypted metadata: names + KDF salt + verifier) ---

export async function fetchTenantIndex(): Promise<TenantIndex | null> {
  try {
    const response = await fetch(TENANTS_URL, { headers: { Accept: "application/json" } });
    if (response.status === 401) return null;
    if (!response.ok) return null;
    return sanitizeTenantIndex(await response.json());
  } catch {
    return null;
  }
}

export async function pushTenantIndex(index: TenantIndex): Promise<boolean> {
  try {
    const response = await fetch(TENANTS_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenants: index.tenants }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// --- Per-tenant encrypted payload ---

export type TenantFetch = { ok: true; data: CloudData } | { ok: false; reason: "empty" | "offline" | "decrypt" };

export async function fetchTenantData(tenantId: string, key: CryptoKey): Promise<TenantFetch> {
  try {
    const response = await fetch(tenantDataUrl(tenantId), { headers: { Accept: "application/json" } });
    if (response.status === 404) return { ok: true, data: emptyCloudData() };
    if (!response.ok) return { ok: false, reason: "offline" };
    const body = (await response.json()) as { iv?: string; ciphertext?: string };
    if (!body.iv || !body.ciphertext) return { ok: true, data: emptyCloudData() };
    const plain = await decryptString(key, body.iv, body.ciphertext);
    if (plain === null) return { ok: false, reason: "decrypt" };
    return { ok: true, data: parseCloudData(JSON.parse(plain)) };
  } catch {
    return { ok: false, reason: "offline" };
  }
}

export async function pushTenantData(tenantId: string, key: CryptoKey, data: CloudData): Promise<boolean> {
  try {
    const encrypted = await encryptString(key, serializeCloudData(data));
    const response = await fetch(tenantDataUrl(tenantId), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(encrypted),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function deleteTenantData(tenantId: string): Promise<void> {
  try {
    await fetch(tenantDataUrl(tenantId), { method: "DELETE" });
  } catch {
    /* offline – the index removal is what matters */
  }
}

// --- Legacy single-blob endpoint, kept only so pre-tenant data can be imported once ---

export async function fetchLegacy(): Promise<CloudData | null> {
  try {
    const response = await fetch(LEGACY_URL, { headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    const data = parseCloudData(await response.json());
    const empty = data.archive.length === 0 && data.tournaments.length === 0 && data.teams.length === 0 && !data.current;
    return empty ? null : data;
  } catch {
    return null;
  }
}
