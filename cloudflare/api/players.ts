import type { AuthContext } from "../auth/session";
import { HttpError, json, readJson, requireSameOrigin } from "../core/http";
import { isId, newId } from "../core/id";
import { birthdateValue, parseBody } from "../core/validation";
import { requireTeamAccess } from "../middleware/tenant";
import { writeAudit } from "../services/audit-service";

interface PlayerRow {
  id: string;
  externalId: string | null;
  firstName: string | null;
  lastName: string | null;
  name: string;
  shirtNumber: string | null;
  passNumber: string | null;
  birthdate: string | null;
  version: number;
  updatedAt: string;
}

const SELECT = "SELECT id,external_id AS externalId,first_name AS firstName,last_name AS lastName,name,shirt_number AS shirtNumber,pass_number AS passNumber,birthdate,version,updated_at AS updatedAt FROM players";
const opt = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);

const NAME_RULES = {
  firstName: { kind: "string", max: 80, optional: true },
  lastName: { kind: "string", max: 80, optional: true },
  name: { kind: "string", max: 120, optional: true },
} as const;

/** Resolve the three name fields: a supplied `name` wins, otherwise it is the two parts joined. */
function resolveName(body: Record<string, unknown>): { firstName: string | null; lastName: string | null; name: string } {
  const firstName = opt(body.firstName);
  const lastName = opt(body.lastName);
  const name = (opt(body.name) ?? [firstName, lastName].filter(Boolean).join(" ")).trim();
  if (!name) throw new HttpError(422, "VALIDATION_FAILED", "A player name is required.");
  return { firstName, lastName, name };
}

/** The relational roster for the referee's own team (Jugend). Holds pass number + birthdate for the passport check. */
export async function listPlayers(env: Env, auth: AuthContext, clubId: string, teamId: string, requestId: string): Promise<Response> {
  const context = await requireTeamAccess(env.DB, auth, clubId, teamId, "players.read");
  const rows = await env.DB.prepare(`${SELECT} WHERE club_id=? AND team_id=? ORDER BY last_name,name,id`).bind(context.clubId, context.teamId).all<PlayerRow>();
  return json({ players: rows.results }, requestId);
}

export async function createPlayer(request: Request, env: Env, auth: AuthContext, clubId: string, teamId: string, requestId: string): Promise<Response> {
  requireSameOrigin(request);
  const context = await requireTeamAccess(env.DB, auth, clubId, teamId, "players.manage");
  const body = parseBody(await readJson(request, 8_192), {
    ...NAME_RULES,
    shirtNumber: { kind: "string", max: 8, optional: true },
    passNumber: { kind: "string", max: 40, optional: true },
    birthdate: { kind: "string", max: 12, optional: true },
    externalId: { kind: "string", max: 120, optional: true },
  });
  const birthdate = birthdateValue(body.birthdate);
  const player = { id: newId(), externalId: opt(body.externalId), ...resolveName(body), shirtNumber: opt(body.shirtNumber), passNumber: opt(body.passNumber), birthdate, version: 1 };
  const now = new Date().toISOString();
  try {
    await env.DB.prepare("INSERT INTO players (club_id,id,team_id,external_id,first_name,last_name,name,shirt_number,pass_number,birthdate,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)")
      .bind(context.clubId, player.id, context.teamId, player.externalId, player.firstName, player.lastName, player.name, player.shirtNumber, player.passNumber, player.birthdate, now, now).run();
  } catch {
    throw new HttpError(409, "PLAYER_EXISTS", "A player with that external id already exists in this team.");
  }
  await writeAudit(env.DB, {
    clubId: context.clubId, userId: auth.userId, action: "PLAYER_CREATED", entityType: "player", entityId: player.id,
    metadata: { teamId: context.teamId, hasPassNumber: player.passNumber !== null, hasBirthdate: player.birthdate !== null, source: player.externalId ? "dfbnet" : "manual" },
  });
  return json({ player: { ...player, updatedAt: now } }, requestId, 201);
}

export async function updatePlayer(request: Request, env: Env, auth: AuthContext, clubId: string, teamId: string, playerId: string, requestId: string): Promise<Response> {
  requireSameOrigin(request);
  const context = await requireTeamAccess(env.DB, auth, clubId, teamId, "players.manage");
  if (!isId(playerId)) throw new HttpError(404, "NOT_FOUND", "The requested resource was not found.");
  const body = parseBody(await readJson(request, 8_192), {
    version: { kind: "int", min: 1, max: 2_147_483_647 },
    ...NAME_RULES,
    shirtNumber: { kind: "string", max: 8, optional: true },
    passNumber: { kind: "string", max: 40, optional: true },
    birthdate: { kind: "string", max: 12, optional: true },
  });
  const birthdate = birthdateValue(body.birthdate);
  const { firstName, lastName, name } = resolveName(body);
  const now = new Date().toISOString();
  const updated = await env.DB.prepare("UPDATE players SET first_name=?,last_name=?,name=?,shirt_number=?,pass_number=?,birthdate=?,version=version+1,updated_at=? WHERE club_id=? AND team_id=? AND id=? AND version=?")
    .bind(firstName, lastName, name, opt(body.shirtNumber), opt(body.passNumber), birthdate, now, context.clubId, context.teamId, playerId, body.version).run();
  if (updated.meta.changes !== 1) {
    const exists = await env.DB.prepare("SELECT 1 FROM players WHERE club_id=? AND team_id=? AND id=?").bind(context.clubId, context.teamId, playerId).first();
    throw exists
      ? new HttpError(409, "VERSION_CONFLICT", "The player was changed by another client.")
      : new HttpError(404, "NOT_FOUND", "The requested resource was not found.");
  }
  await writeAudit(env.DB, {
    clubId: context.clubId, userId: auth.userId, action: "PLAYER_UPDATED", entityType: "player", entityId: playerId,
    metadata: { teamId: context.teamId, fields: ["firstName", "lastName", "name", "shirtNumber", "passNumber", "birthdate"].filter((key) => key in body).join(",") },
  });
  return json({ player: { id: playerId, firstName, lastName, name, shirtNumber: opt(body.shirtNumber), passNumber: opt(body.passNumber), birthdate, version: (body.version as number) + 1, updatedAt: now } }, requestId);
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
  await writeAudit(env.DB, { clubId: context.clubId, userId: auth.userId, action: "PLAYER_DELETED", entityType: "player", entityId: playerId, metadata: { teamId: context.teamId } });
  return json({ ok: true }, requestId);
}
