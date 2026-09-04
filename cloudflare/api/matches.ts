import type { AuthContext } from "../auth/session";
import { HttpError, json, readJson, requireSameOrigin } from "../core/http";
import { isId, newId } from "../core/id";
import { boundedJson, integerValue, objectValue, stringValue } from "../core/validation";
import { abortBatchUnlessOneChange, versionConflictOr } from "../core/optimistic";
import { denyTeamScoped, requireTenantAccess } from "../middleware/tenant";
import { writeAudit } from "../services/audit-service";

interface MatchInput {
  teamId: string;
  matchDate: string;
  competition: string;
  venue: string;
  state: "setup" | "live" | "finished" | "abandoned";
  payloadJson: string;
  events: Array<{ id: string; eventType: string; matchMs: number; payloadJson: string }>;
}

function parseInput(value: unknown): MatchInput {
  const source = objectValue(value);
  const teamId = stringValue(source, "teamId", { min: 20, max: 64 })!;
  if (!isId(teamId)) throw new HttpError(422, "VALIDATION_FAILED", "The request data is invalid.");
  const matchDate = stringValue(source, "matchDate", { min: 1, max: 40 })!;
  const competition = stringValue(source, "competition", { max: 160, optional: true }) ?? "";
  const venue = stringValue(source, "venue", { max: 200, optional: true }) ?? "";
  const state = stringValue(source, "state", { min: 1, max: 20 })!;
  if (state !== "setup" && state !== "live" && state !== "finished" && state !== "abandoned") throw new HttpError(422, "VALIDATION_FAILED", "The request data is invalid.");
  const rawEvents = source.events ?? [];
  if (!Array.isArray(rawEvents) || rawEvents.length > 1000) throw new HttpError(422, "VALIDATION_FAILED", "The request data is invalid.");
  const events = rawEvents.map((raw) => {
    const event = objectValue(raw);
    const suppliedId = stringValue(event, "id", { min: 36, max: 36, optional: true });
    if (suppliedId && !isId(suppliedId)) throw new HttpError(422, "VALIDATION_FAILED", "The request data is invalid.");
    return {
      id: suppliedId ?? newId(),
      eventType: stringValue(event, "eventType", { min: 1, max: 40 })!,
      matchMs: integerValue(event, "matchMs", { min: 0, max: 1000 * 60 * 60 }),
      payloadJson: boundedJson(event.payload ?? {}, 32_768),
    };
  });
  return { teamId, matchDate, competition, venue, state, payloadJson: boundedJson(source.payload ?? {}, 512_000), events };
}

/** The flat club-wide match endpoints require an explicit team of the same club. */
async function requireTeamOfClub(env: Env, clubId: string, teamId: string): Promise<void> {
  const team = await env.DB.prepare("SELECT 1 FROM teams WHERE club_id=? AND id=?").bind(clubId, teamId).first();
  if (!team) throw new HttpError(422, "VALIDATION_FAILED", "The team does not belong to this club.");
}

function cursorValue(value: string | null): { date: string; id: string } | null {
  if (!value) return null;
  try {
    const decoded = JSON.parse(atob(value.replaceAll("-", "+").replaceAll("_", "/"))) as { date?: unknown; id?: unknown };
    if (typeof decoded.date !== "string" || typeof decoded.id !== "string" || !isId(decoded.id)) return null;
    return { date: decoded.date.slice(0, 40), id: decoded.id };
  } catch {
    return null;
  }
}

function encodeCursor(date: string, id: string): string {
  return btoa(JSON.stringify({ date, id })).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export async function listMatches(request: Request, env: Env, auth: AuthContext, clubId: string, requestId: string): Promise<Response> {
  const context = await requireTenantAccess(env.DB, auth, clubId, "matches.read");
  denyTeamScoped(context);
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50) || 50, 1), 100);
  const cursor = cursorValue(url.searchParams.get("cursor"));
  if (url.searchParams.has("cursor") && !cursor) throw new HttpError(400, "INVALID_CURSOR", "The pagination cursor is invalid.");
  const query = cursor
    ? env.DB.prepare(`SELECT id,team_id AS teamId,match_date AS matchDate,competition,venue,state,payload_json AS payloadJson,version,created_at AS createdAt,updated_at AS updatedAt
        FROM matches WHERE club_id=? AND deleted_at IS NULL AND (match_date<? OR (match_date=? AND id<?)) ORDER BY match_date DESC,id DESC LIMIT ?`).bind(context.clubId, cursor.date, cursor.date, cursor.id, limit + 1)
    : env.DB.prepare(`SELECT id,team_id AS teamId,match_date AS matchDate,competition,venue,state,payload_json AS payloadJson,version,created_at AS createdAt,updated_at AS updatedAt
        FROM matches WHERE club_id=? AND deleted_at IS NULL ORDER BY match_date DESC,id DESC LIMIT ?`).bind(context.clubId, limit + 1);
  const result = await query.all<Record<string, unknown> & { id: string; matchDate: string; payloadJson: string }>();
  const page = result.results.slice(0, limit).map((row) => ({ ...row, payload: JSON.parse(row.payloadJson), payloadJson: undefined }));
  const last = page.at(-1) as { id: string; matchDate: string } | undefined;
  return json({ matches: page, nextCursor: result.results.length > limit && last ? encodeCursor(last.matchDate, last.id) : null }, requestId);
}

export async function getMatch(env: Env, auth: AuthContext, clubId: string, matchId: string, requestId: string): Promise<Response> {
  const context = await requireTenantAccess(env.DB, auth, clubId, "matches.read");
  denyTeamScoped(context);
  if (!isId(matchId)) throw new HttpError(404, "NOT_FOUND", "The requested resource was not found.");
  const match = await env.DB.prepare(`SELECT id,team_id AS teamId,match_date AS matchDate,competition,venue,state,payload_json AS payloadJson,version,created_at AS createdAt,updated_at AS updatedAt
    FROM matches WHERE club_id=? AND id=? AND deleted_at IS NULL`).bind(context.clubId, matchId).first<Record<string, unknown> & { payloadJson: string }>();
  if (!match) throw new HttpError(404, "NOT_FOUND", "The requested resource was not found.");
  const events = await env.DB.prepare(`SELECT id,event_type AS eventType,match_ms AS matchMs,payload_json AS payloadJson,created_at AS createdAt,updated_at AS updatedAt
    FROM match_events WHERE club_id=? AND match_id=? ORDER BY match_ms,id`).bind(context.clubId, matchId).all<Record<string, unknown> & { payloadJson: string }>();
  return json({ match: { ...match, payload: JSON.parse(match.payloadJson), payloadJson: undefined, events: events.results.map((event) => ({ ...event, payload: JSON.parse(event.payloadJson), payloadJson: undefined })) } }, requestId);
}

export async function createMatch(request: Request, env: Env, auth: AuthContext, clubId: string, requestId: string): Promise<Response> {
  requireSameOrigin(request);
  const context = await requireTenantAccess(env.DB, auth, clubId, "matches.create");
  denyTeamScoped(context);
  const input = parseInput(await readJson(request, 1_048_576));
  await requireTeamOfClub(env, context.clubId, input.teamId);
  const id = newId();
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`INSERT INTO matches (club_id,team_id,id,match_date,competition,venue,state,payload_json,version,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,1,?,?)`).bind(context.clubId, input.teamId, id, input.matchDate, input.competition, input.venue, input.state, input.payloadJson, now, now),
    ...input.events.map((event) => env.DB.prepare(`INSERT INTO match_events (club_id,team_id,id,match_id,event_type,match_ms,payload_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).bind(context.clubId, input.teamId, event.id, id, event.eventType, event.matchMs, event.payloadJson, now, now)),
  ];
  await env.DB.batch(statements);
  await writeAudit(env.DB, { clubId: context.clubId, userId: auth.userId, action: "MATCH_CREATED", entityType: "match", entityId: id });
  return json({ match: { id, version: 1 } }, requestId, 201);
}

async function ensureMatch(env: Env, clubId: string, matchId: string): Promise<{ version: number }>{
  if (!isId(matchId)) throw new HttpError(404, "NOT_FOUND", "The requested resource was not found.");
  const row = await env.DB.prepare("SELECT version FROM matches WHERE club_id=? AND id=? AND deleted_at IS NULL").bind(clubId, matchId).first<{ version: number }>();
  if (!row) throw new HttpError(404, "NOT_FOUND", "The requested resource was not found.");
  return row;
}

export async function updateMatch(request: Request, env: Env, auth: AuthContext, clubId: string, matchId: string, requestId: string): Promise<Response> {
  requireSameOrigin(request);
  const context = await requireTenantAccess(env.DB, auth, clubId, "matches.update");
  denyTeamScoped(context);
  await ensureMatch(env, context.clubId, matchId);
  const body = objectValue(await readJson(request, 1_048_576));
  const expectedVersion = integerValue(body, "version", { min: 1, max: 2_147_483_647 });
  const input = parseInput(body);
  await requireTeamOfClub(env, context.clubId, input.teamId);
  const now = new Date().toISOString();
  // Version bump + event rewrite in one batch (= one D1 transaction); the guard
  // rolls the whole batch back if a racing writer bumped the version first.
  const statements = [
    env.DB.prepare(`UPDATE matches SET team_id=?,match_date=?,competition=?,venue=?,state=?,payload_json=?,version=version+1,updated_at=?
      WHERE club_id=? AND id=? AND deleted_at IS NULL AND version=?`).bind(input.teamId, input.matchDate, input.competition, input.venue, input.state, input.payloadJson, now, context.clubId, matchId, expectedVersion),
    abortBatchUnlessOneChange(env.DB, "matches", ["club_id", "id"], [context.clubId, matchId]),
    env.DB.prepare("DELETE FROM match_events WHERE club_id=? AND match_id=?").bind(context.clubId, matchId),
    ...input.events.map((event) => env.DB.prepare(`INSERT INTO match_events (club_id,team_id,id,match_id,event_type,match_ms,payload_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).bind(context.clubId, input.teamId, event.id, matchId, event.eventType, event.matchMs, event.payloadJson, now, now)),
  ];
  try {
    await env.DB.batch(statements);
  } catch (error) {
    await versionConflictOr(env.DB, error, { table: "matches", where: "club_id=? AND id=?", binds: [context.clubId, matchId], expected: expectedVersion });
  }
  await writeAudit(env.DB, { clubId: context.clubId, userId: auth.userId, action: "MATCH_UPDATED", entityType: "match", entityId: matchId, metadata: { version: expectedVersion + 1 } });
  return json({ match: { id: matchId, version: expectedVersion + 1 } }, requestId);
}

export async function deleteMatch(request: Request, env: Env, auth: AuthContext, clubId: string, matchId: string, requestId: string): Promise<Response> {
  requireSameOrigin(request);
  const context = await requireTenantAccess(env.DB, auth, clubId, "matches.delete");
  denyTeamScoped(context);
  await ensureMatch(env, context.clubId, matchId);
  const body = objectValue(await readJson(request, 4096));
  const version = integerValue(body, "version", { min: 1, max: 2_147_483_647 });
  const now = new Date().toISOString();
  const result = await env.DB.prepare("UPDATE matches SET deleted_at=?,updated_at=?,version=version+1 WHERE club_id=? AND id=? AND deleted_at IS NULL AND version=?")
    .bind(now, now, context.clubId, matchId, version).run();
  if (result.meta.changes !== 1) throw new HttpError(409, "VERSION_CONFLICT", "The match was changed by another client.");
  await writeAudit(env.DB, { clubId: context.clubId, userId: auth.userId, action: "MATCH_DELETED", entityType: "match", entityId: matchId });
  return json({ ok: true }, requestId);
}
