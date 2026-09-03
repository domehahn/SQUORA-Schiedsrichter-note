import type { AuthContext } from "../auth/session";
import { minimize } from "../core/dfbnet";
import { HttpError, json, readJson, requireSameOrigin } from "../core/http";
import { clientIp, enforceRateLimit } from "../core/rate-limit";
import { isId, newId } from "../core/id";
import { objectValue, stringValue } from "../core/validation";
import { requireTeamAccess } from "../middleware/tenant";
import { writeAudit } from "../services/audit-service";

const MAX_ROWS = 5000;
const encoder = new TextEncoder();

interface RosterPlayer {
  name: string;
  firstName: string | null;
  shirtNumber: string | null;
  externalId: string | null;
}

interface RosterInput {
  filename: string;
  players: RosterPlayer[];
  confirm: boolean;
}

function parseRoster(value: unknown): RosterInput {
  const source = objectValue(value);
  const filename = stringValue(source, "filename", { min: 1, max: 255 })!;
  const raw = source.players;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ROWS) {
    throw new HttpError(422, "VALIDATION_FAILED", "The roster payload is invalid.");
  }
  const players = raw.map((entry) => {
    const player = objectValue(minimize(entry));
    return {
      name: stringValue(player, "name", { min: 1, max: 120 })!,
      firstName: stringValue(player, "firstName", { max: 120, optional: true }) ?? null,
      shirtNumber: stringValue(player, "shirtNumber", { max: 8, optional: true }) ?? null,
      externalId: stringValue(player, "externalId", { max: 120, optional: true }) ?? null,
    };
  });
  return { filename, players, confirm: source.confirm === true };
}

/** Stable content hash over the normalized roster, scoped to the target team, independent of client input. */
async function fingerprint(teamId: string, players: RosterPlayer[]): Promise<string> {
  const rows = players
    .map((p) => [p.externalId ?? "", p.name, p.firstName ?? "", p.shirtNumber ?? ""])
    .sort((a, b) => (a.join(" ") < b.join(" ") ? -1 : 1));
  const canonical = JSON.stringify([teamId, ...rows]);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(canonical)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function upsertStatements(db: D1Database, clubId: string, teamId: string, players: RosterPlayer[], now: string): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  for (const player of players) {
    if (player.externalId) {
      statements.push(db.prepare(
        "INSERT INTO players (club_id,id,team_id,external_id,name,shirt_number,version,created_at,updated_at) " +
        "VALUES (?,?,?,?,?,?,1,?,?) " +
        "ON CONFLICT(club_id,team_id,external_id) DO UPDATE SET " +
        "name=excluded.name, shirt_number=excluded.shirt_number, updated_at=excluded.updated_at, version=players.version+1",
      ).bind(clubId, newId(), teamId, player.externalId, player.name, player.shirtNumber, now, now));
    } else {
      statements.push(db.prepare(
        "INSERT INTO players (club_id,id,team_id,external_id,name,shirt_number,version,created_at,updated_at) " +
        "SELECT ?,?,?,NULL,?,?,1,?,? " +
        "WHERE NOT EXISTS (SELECT 1 FROM players WHERE club_id=? AND team_id=? AND external_id IS NULL AND name=?)",
      ).bind(clubId, newId(), teamId, player.name, player.shirtNumber, now, now, clubId, teamId, player.name));
      statements.push(db.prepare(
        "UPDATE players SET shirt_number=?, updated_at=?, version=version+1 " +
        "WHERE club_id=? AND team_id=? AND external_id IS NULL AND name=?",
      ).bind(player.shirtNumber, now, clubId, teamId, player.name));
    }
  }
  return statements;
}

async function applyImport(env: Env, auth: AuthContext, clubId: string, teamId: string, importId: string, players: RosterPlayer[]): Promise<void> {
  const now = new Date().toISOString();
  try {
    await env.DB.batch(upsertStatements(env.DB, clubId, teamId, players, now));
    await env.DB.prepare("UPDATE dfbnet_imports SET status='completed',completed_at=?,record_count=? WHERE club_id=? AND id=?")
      .bind(now, players.length, clubId, importId).run();
    await writeAudit(env.DB, { clubId, userId: auth.userId, action: "DFBNET_IMPORT_COMPLETED", entityType: "dfbnet_import", entityId: importId, metadata: { records: players.length, teamId } });
  } catch (error) {
    await env.DB.prepare("UPDATE dfbnet_imports SET status='failed',completed_at=?,error_summary=? WHERE club_id=? AND id=?")
      .bind(now, "roster persistence failed", clubId, importId).run();
    await writeAudit(env.DB, { clubId, userId: auth.userId, action: "DFBNET_IMPORT_FAILED", entityType: "dfbnet_import", entityId: importId, metadata: { teamId } });
    throw error;
  }
}

/**
 * Stage a DFBnet roster import. The client supplies an already-minimized player
 * list (whitelist enforced client-side); the server re-validates, strips
 * forbidden fields again, fingerprints the content and records a
 * `dfbnet_imports` row. `confirm: true` also writes the players in one call.
 */
export async function createDfbnetImport(request: Request, env: Env, auth: AuthContext, clubId: string, teamId: string, requestId: string): Promise<Response> {
  requireSameOrigin(request);
  const context = await requireTeamAccess(env.DB, auth, clubId, teamId, "dfbnet.import");
  await enforceRateLimit(env.IMPORT_RATE_LIMITER, [clientIp(request), auth.userId, context.clubId, "dfbnet.import"]);
  const input = parseRoster(await readJson(request, 4_194_304));
  const print = await fingerprint(context.teamId, input.players);

  const existing = await env.DB.prepare("SELECT id,status,record_count AS recordCount FROM dfbnet_imports WHERE club_id=? AND fingerprint=?")
    .bind(context.clubId, print).first<{ id: string; status: string; recordCount: number }>();
  if (existing?.status === "completed") {
    return json({ importId: existing.id, status: "completed", recordCount: existing.recordCount, duplicate: true }, requestId);
  }

  const importId = existing?.id ?? newId();
  const now = new Date().toISOString();
  if (!existing) {
    await env.DB.prepare("INSERT INTO dfbnet_imports (club_id,id,user_id,team_id,source,filename,fingerprint,status,record_count,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(context.clubId, importId, auth.userId, context.teamId, "dfbnet_csv", input.filename, print, "previewed", input.players.length, now).run();
    await writeAudit(env.DB, { clubId: context.clubId, userId: auth.userId, action: "DFBNET_IMPORT_STARTED", entityType: "dfbnet_import", entityId: importId, metadata: { records: input.players.length, teamId } });
  }

  if (input.confirm) {
    await applyImport(env, auth, context.clubId, context.teamId, importId, input.players);
    return json({ importId, status: "completed", recordCount: input.players.length }, requestId, existing ? 200 : 201);
  }
  return json({ importId, status: "previewed", recordCount: input.players.length, fingerprint: print }, requestId, existing ? 200 : 201);
}

/** Apply a previously previewed import. The roster payload must be resent and must fingerprint-match. */
export async function confirmDfbnetImport(request: Request, env: Env, auth: AuthContext, clubId: string, teamId: string, importId: string, requestId: string): Promise<Response> {
  requireSameOrigin(request);
  const context = await requireTeamAccess(env.DB, auth, clubId, teamId, "dfbnet.import");
  await enforceRateLimit(env.IMPORT_RATE_LIMITER, [clientIp(request), auth.userId, context.clubId, "dfbnet.import"]);
  if (!isId(importId)) throw new HttpError(404, "NOT_FOUND", "The requested resource was not found.");
  const row = await env.DB.prepare("SELECT status,fingerprint,record_count AS recordCount FROM dfbnet_imports WHERE club_id=? AND id=? AND team_id=?")
    .bind(context.clubId, importId, context.teamId).first<{ status: string; fingerprint: string; recordCount: number }>();
  if (!row) throw new HttpError(404, "NOT_FOUND", "The requested resource was not found.");
  if (row.status === "completed") return json({ importId, status: "completed", recordCount: row.recordCount, duplicate: true }, requestId);
  if (row.status === "failed") throw new HttpError(409, "IMPORT_FAILED", "This import can no longer be confirmed.");

  const input = parseRoster(await readJson(request, 4_194_304));
  if (await fingerprint(context.teamId, input.players) !== row.fingerprint) {
    throw new HttpError(422, "PAYLOAD_MISMATCH", "The roster does not match the previewed import.");
  }
  await applyImport(env, auth, context.clubId, context.teamId, importId, input.players);
  return json({ importId, status: "completed", recordCount: input.players.length }, requestId);
}

/** Import history for a team (metadata only — never CSV content). */
export async function listDfbnetImports(request: Request, env: Env, auth: AuthContext, clubId: string, teamId: string, requestId: string): Promise<Response> {
  const context = await requireTeamAccess(env.DB, auth, clubId, teamId, "dfbnet.read");
  const limit = Math.min(Math.max(Number(new URL(request.url).searchParams.get("limit") ?? 50) || 50, 1), 100);
  const rows = await env.DB.prepare(
    "SELECT id,user_id AS userId,source,filename,status,record_count AS recordCount,created_at AS createdAt,completed_at AS completedAt,error_summary AS errorSummary " +
    "FROM dfbnet_imports WHERE club_id=? AND team_id=? ORDER BY created_at DESC,id LIMIT ?",
  ).bind(context.clubId, context.teamId, limit).all();
  return json({ imports: rows.results }, requestId);
}
