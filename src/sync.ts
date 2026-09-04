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
/** Last snapshot the server confirmed, per scope — the basis for delta pushes. */
const lastSnapshot = new Map<string, CloudData>();

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

// ---- invitations ----------------------------------------------------------

export interface InvitationPreview { clubName: string; role: string; teamName: string | null; expiresAt: string }

/** Pull a bare token out of a pasted invitation link or return the trimmed input. */
export function invitationToken(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/invitations?\/([A-Za-z0-9_-]{20,64})/) ?? trimmed.match(/[?&]invite=([A-Za-z0-9_-]{20,64})/);
  return match ? match[1] : trimmed;
}

export async function viewInvitation(token: string): Promise<InvitationPreview | null> {
  try {
    const response = await fetch(`${API}/invitations/${enc(token)}`, { headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    const body = await response.json() as { invitation?: Record<string, unknown> };
    const invite = body.invitation;
    return invite && typeof invite.clubName === "string" && typeof invite.expiresAt === "string"
      ? { clubName: invite.clubName, role: typeof invite.role === "string" ? invite.role : "", teamName: typeof invite.teamName === "string" ? invite.teamName : null, expiresAt: invite.expiresAt }
      : null;
  } catch { return null; }
}

export async function acceptInvitation(token: string): Promise<{ ok: boolean; status: number }> {
  try {
    const response = await fetch(`${API}/invitations/accept`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }),
    });
    return { ok: response.ok, status: response.status };
  } catch { return { ok: false, status: 0 }; }
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

// ---- relational team roster (players) ---------------------------------------

export interface RosterPlayer {
  id: string;
  externalId: string | null;
  firstName: string | null;
  lastName: string | null;
  name: string;
  shirtNumber: string | null;
  passNumber: string | null;
  birthdate: string | null;
  version: number;
}

export interface DfbnetImportRow {
  id: string;
  filename: string;
  status: string;
  recordCount: number;
  createdAt: string;
}

const playersUrl = (clubId: string, teamId: string) => `${API}/clubs/${enc(clubId)}/teams/${enc(teamId)}/players`;
const importsUrl = (clubId: string, teamId: string) => `${API}/clubs/${enc(clubId)}/teams/${enc(teamId)}/dfbnet/imports`;

function isRosterPlayer(value: unknown): value is RosterPlayer {
  const p = value as Partial<RosterPlayer> | undefined;
  return Boolean(p && typeof p.id === "string" && typeof p.name === "string" && typeof p.version === "number");
}

export async function fetchPlayers(clubId: string, teamId: string): Promise<RosterPlayer[] | null> {
  try {
    const response = await fetch(playersUrl(clubId, teamId), { headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    const body = await response.json() as { players?: unknown };
    return Array.isArray(body.players) ? body.players.filter(isRosterPlayer) : [];
  } catch { return null; }
}

export interface PlayerInput {
  firstName?: string;
  lastName?: string;
  name?: string;
  shirtNumber?: string;
  passNumber?: string;
  birthdate?: string;
}

const playerBody = (input: PlayerInput): Record<string, unknown> => ({
  ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
  ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
  ...(input.name !== undefined ? { name: input.name } : {}),
  ...(input.shirtNumber !== undefined ? { shirtNumber: input.shirtNumber } : {}),
  ...(input.passNumber !== undefined ? { passNumber: input.passNumber } : {}),
  ...(input.birthdate !== undefined ? { birthdate: input.birthdate } : {}),
});

export async function createPlayer(clubId: string, teamId: string, input: PlayerInput): Promise<RosterPlayer | null> {
  try {
    const response = await fetch(playersUrl(clubId, teamId), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(playerBody(input)),
    });
    if (!response.ok) return null;
    const body = await response.json() as { player?: unknown };
    return isRosterPlayer(body.player) ? body.player : null;
  } catch { return null; }
}

export async function updatePlayer(clubId: string, teamId: string, id: string, input: { version: number } & PlayerInput): Promise<RosterPlayer | "conflict" | null> {
  try {
    const response = await fetch(`${playersUrl(clubId, teamId)}/${enc(id)}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: input.version, ...playerBody(input) }),
    });
    if (response.status === 409) return "conflict";
    if (!response.ok) return null;
    const body = await response.json() as { player?: unknown };
    return isRosterPlayer(body.player) ? body.player : null;
  } catch { return null; }
}

export async function clearPlayers(clubId: string, teamId: string): Promise<boolean> {
  try {
    const response = await fetch(playersUrl(clubId, teamId), { method: "DELETE", headers: { "Content-Type": "application/json" } });
    return response.ok;
  } catch { return false; }
}

export async function deletePlayer(clubId: string, teamId: string, id: string, version: number): Promise<boolean> {
  try {
    const response = await fetch(`${playersUrl(clubId, teamId)}/${enc(id)}`, {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version }),
    });
    return response.ok;
  } catch { return false; }
}

export async function fetchDfbnetImports(clubId: string, teamId: string): Promise<DfbnetImportRow[] | null> {
  try {
    const response = await fetch(importsUrl(clubId, teamId), { headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    const body = await response.json() as { imports?: unknown };
    if (!Array.isArray(body.imports)) return [];
    return body.imports.filter((entry): entry is DfbnetImportRow => {
      const row = entry as Partial<DfbnetImportRow>;
      return Boolean(row && typeof row.id === "string" && typeof row.filename === "string" && typeof row.status === "string");
    });
  } catch { return null; }
}

export async function pushDfbnetRoster(
  clubId: string, teamId: string,
  input: { filename: string; players: { name: string; firstName?: string; lastName?: string; shirtNumber?: string; externalId?: string; passNumber?: string; birthdate?: string }[]; mode: "merge" | "replace" },
): Promise<{ ok: boolean; recordCount: number }> {
  try {
    const response = await fetch(importsUrl(clubId, teamId), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: input.filename, mode: input.mode, confirm: true, players: input.players }),
    });
    if (!response.ok) return { ok: false, recordCount: 0 };
    const body = await response.json() as { recordCount?: unknown };
    return { ok: true, recordCount: typeof body.recordCount === "number" ? body.recordCount : input.players.length };
  } catch { return { ok: false, recordCount: 0 }; }
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
    const data = parseCloudData(body);
    lastSnapshot.set(scope, data);
    return { ok: true, data };
  } catch { return { ok: false, reason: "offline" }; }
}

const matchSig = (entry: SavedMatch): string => `${entry.savedAt} ${JSON.stringify(entry.state)}`;

/** Diff `data` against the last server-confirmed snapshot; returns a delta body, or null to send the full snapshot. */
function buildDelta(prev: CloudData | undefined, data: CloudData, version: number): Record<string, unknown> | null {
  if (!prev) return null;
  const prevMatch = new Map(prev.archive.map((entry) => [entry.state.id, matchSig(entry)]));
  const currentMatchIds = new Set(data.archive.map((entry) => entry.state.id));
  const matchUpsert = data.archive.filter((entry) => prevMatch.get(entry.state.id) !== matchSig(entry));
  const matchRemove = [...prevMatch.keys()].filter((id) => !currentMatchIds.has(id));

  const prevTour = new Map(prev.tournaments.map((t) => [t.id, JSON.stringify(t)]));
  const currentTourIds = new Set(data.tournaments.map((t) => t.id));
  const tourUpsert = data.tournaments.filter((t) => prevTour.get(t.id) !== JSON.stringify(t));
  const tourRemove = [...prevTour.keys()].filter((id) => !currentTourIds.has(id));

  const body: Record<string, unknown> = {
    version,
    delta: true,
    matches: { upsert: matchUpsert, removeIds: matchRemove },
    tournaments: { upsert: tourUpsert, removeIds: tourRemove },
  };
  if (JSON.stringify(prev.teams) !== JSON.stringify(data.teams)) body.teams = data.teams;
  if (JSON.stringify(prev.current) !== JSON.stringify(data.current)) body.current = data.current;
  return body;
}

export async function pushTenantData(clubId: string, teamId: string, _key: CryptoKey | null, data: CloudData): Promise<boolean> {
  const scope = `${clubId}:${teamId}`;
  const version = versions.get(scope) ?? 0;
  const delta = buildDelta(lastSnapshot.get(scope), data, version);
  const body = delta ?? { version, ...data };
  try {
    const response = await fetch(stateUrl(clubId, teamId), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.status === 409) return false;
    if (!response.ok) return false;
    const responseBody = await response.json() as { version?: unknown };
    if (typeof responseBody.version === "number") versions.set(scope, responseBody.version);
    lastSnapshot.set(scope, data);
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

export interface LegacyTenantSource {
  id: string;
  name: string;
  salt: string;
  verifierIv: string;
  verifier: string;
}

export async function fetchLegacyTenantSources(): Promise<LegacyTenantSource[]> {
  try {
    const response = await fetch(`${API}/legacy/tenants`, { headers: { Accept: "application/json" } });
    if (!response.ok) return [];
    const body = await response.json() as { tenants?: unknown };
    if (!Array.isArray(body.tenants)) return [];
    return body.tenants.filter((entry): entry is LegacyTenantSource => {
      const source = entry as Partial<LegacyTenantSource>;
      return Boolean(source && typeof source.id === "string" && typeof source.name === "string" && typeof source.salt === "string" && typeof source.verifierIv === "string" && typeof source.verifier === "string");
    });
  } catch { return []; }
}

export async function fetchLegacyTenantPayload(id: string): Promise<{ sourceFingerprint: string; payload: { iv: string; ciphertext: string } } | null> {
  try {
    const response = await fetch(`${API}/legacy/tenants/${enc(id)}/payload`, { headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    const body = await response.json() as { sourceFingerprint?: unknown; payload?: { iv?: unknown; ciphertext?: unknown } };
    return typeof body.sourceFingerprint === "string" && typeof body.payload?.iv === "string" && typeof body.payload.ciphertext === "string"
      ? { sourceFingerprint: body.sourceFingerprint, payload: { iv: body.payload.iv, ciphertext: body.payload.ciphertext } }
      : null;
  } catch { return null; }
}

export async function migrateLegacyTenant(clubId: string, teamId: string, legacyTenantId: string, sourceFingerprint: string, data: CloudData): Promise<boolean> {
  const scope = `${clubId}:${teamId}`;
  try {
    const response = await fetch(`${API}/clubs/${enc(clubId)}/teams/${enc(teamId)}/migrations/legacy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ legacyTenantId, sourceFingerprint, data: { version: versions.get(scope) ?? 0, ...data } }),
    });
    if (!response.ok) return false;
    versions.delete(scope);
    lastSnapshot.delete(scope);
    return true;
  } catch { return false; }
}
