import type { AuthContext } from "../auth/session";
import { HttpError, json, readJson, requireSameOrigin } from "../core/http";
import { isId, newId } from "../core/id";
import { parseBody } from "../core/validation";
import { requireTeamAccess } from "../middleware/tenant";

interface PlayerRow {
  id: string;
  externalId: string | null;
  name: string;
  shirtNumber: string | null;
  version: number;
  updatedAt: string;
}

const SELECT = "SELECT id,external_id AS externalId,name,shirt_number AS shirtNumber,version,updated_at AS updatedAt FROM players";

/** The relational roster for the referee's own team (Jugend). */
export async function listPlayers(env: Env, auth: AuthContext, clubId: string, teamId: string, requestId: string): Promise<Response> {
  const context = await requireTeamAccess(env.DB, auth, clubId, teamId, "players.read");
  const rows = await env.DB.prepare(`${SELECT} WHERE club_id=? AND team_id=? ORDER BY name,id`).bind(context.clubId, context.teamId).all<PlayerRow>();
  return json({ players: rows.results }, requestId);
}

export async function createPlayer(request: Request, env: Env, auth: AuthContext, clubId: string, teamId: string, requestId: string): Promise<Response> {
  requireSameOrigin(request);
  const context = await requireTeamAccess(env.DB, auth, clubId, teamId, "players.manage");
  const body = parseBody(await readJson(request, 8_192), {
    name: { kind: "string", min: 1, max: 120 },
    shirtNumber: { kind: "string", max: 8, optional: true },
    externalId: { kind: "string", max: 120, optional: true },
  });
  const id = newId();
  const now = new Date().toISOString();
  try {
    await env.DB.prepare("INSERT INTO players (club_id,id,team_id,external_id,name,shirt_number,version,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?)")
      .bind(context.clubId, id, context.teamId, (body.externalId as string | undefined) ?? null, body.name, (body.shirtNumber as string | undefined) ?? null, now, now).run();
  } catch {
    throw new HttpError(409, "PLAYER_EXISTS", "A player with that external id already exists in this team.");
  }
  return json({ player: { id, externalId: (body.externalId as string | undefined) ?? null, name: body.name, shirtNumber: (body.shirtNumber as string | undefined) ?? null, version: 1, updatedAt: now } }, requestId, 201);
}

export async function updatePlayer(request: Request, env: Env, auth: AuthContext, clubId: string, teamId: string, playerId: string, requestId: string): Promise<Response> {
  requireSameOrigin(request);
  const context = await requireTeamAccess(env.DB, auth, clubId, teamId, "players.manage");
  if (!isId(playerId)) throw new HttpError(404, "NOT_FOUND", "The requested resource was not found.");
  const body = parseBody(await readJson(request, 8_192), {
    version: { kind: "int", min: 1, max: 2_147_483_647 },
    name: { kind: "string", min: 1, max: 120 },
    shirtNumber: { kind: "string", max: 8, optional: true },
  });
  const now = new Date().toISOString();
  const updated = await env.DB.prepare("UPDATE players SET name=?,shirt_number=?,version=version+1,updated_at=? WHERE club_id=? AND team_id=? AND id=? AND version=?")
    .bind(body.name, (body.shirtNumber as string | undefined) ?? null, now, context.clubId, context.teamId, playerId, body.version).run();
  if (updated.meta.changes !== 1) {
    const exists = await env.DB.prepare("SELECT 1 FROM players WHERE club_id=? AND team_id=? AND id=?").bind(context.clubId, context.teamId, playerId).first();
    throw exists
      ? new HttpError(409, "VERSION_CONFLICT", "The player was changed by another client.")
      : new HttpError(404, "NOT_FOUND", "The requested resource was not found.");
  }
  return json({ player: { id: playerId, name: body.name, shirtNumber: (body.shirtNumber as string | undefined) ?? null, version: (body.version as number) + 1, updatedAt: now } }, requestId);
}

export async function deletePlayer(request: Request, env: Env, auth: AuthContext, clubId: string, teamId: string, playerId: string, requestId: string): Promise<Response> {
  requireSameOrigin(request);
  const context = await requireTeamAccess(env.DB, auth, clubId, teamId, "players.manage");
  if (!isId(playerId)) throw new HttpError(404, "NOT_FOUND", "The requested resource was not found.");
  const body = parseBody(await readJson(request, 4096), { version: { kind: "int", min: 1, max: 2_147_483_647 } });
  const deleted = await env.DB.prepare("DELETE FROM players WHERE club_id=? AND team_id=? AND id=? AND version=?")
    .bind(context.clubId, context.teamId, playerId, body.version).run();
  if (deleted.meta.changes !== 1) {
    const exists = await env.DB.prepare("SELECT 1 FROM players WHERE club_id=? AND team_id=? AND id=?").bind(context.clubId, context.teamId, playerId).first();
    throw exists
      ? new HttpError(409, "VERSION_CONFLICT", "The player was changed by another client.")
      : new HttpError(404, "NOT_FOUND", "The requested resource was not found.");
  }
  return json({ ok: true }, requestId);
}
