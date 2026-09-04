import type { AuthContext } from "../auth/session";
import { json, readJson, requireSameOrigin } from "../core/http";
import { newId } from "../core/id";
import { parseBody } from "../core/validation";
import { denyTeamScoped, requireTenantAccess } from "../middleware/tenant";
import { writeAudit } from "../services/audit-service";

interface TeamRow {
  id: string;
  name: string;
  ageGroup: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Lists the teams (Jugenden) of a club the user may see. */
export async function listTeams(env: Env, auth: AuthContext, clubId: string, requestId: string): Promise<Response> {
  const context = await requireTenantAccess(env.DB, auth, clubId, "teams.read");
  const scoped = await env.DB.prepare("SELECT team_id FROM memberships WHERE club_id=? AND user_id=?").bind(context.clubId, auth.userId).first<{ team_id: string | null }>();
  const rows = await env.DB.prepare(
    scoped?.team_id
      ? "SELECT id,name,age_group AS ageGroup,created_at AS createdAt,updated_at AS updatedAt FROM teams WHERE club_id=? AND id=? ORDER BY name,id"
      : "SELECT id,name,age_group AS ageGroup,created_at AS createdAt,updated_at AS updatedAt FROM teams WHERE club_id=? ORDER BY name,id",
  ).bind(...(scoped?.team_id ? [context.clubId, scoped.team_id] : [context.clubId])).all<TeamRow>();
  return json({ teams: rows.results }, requestId);
}

/** Creates a team (Jugend) within a club. */
export async function createTeam(request: Request, env: Env, auth: AuthContext, clubId: string, requestId: string): Promise<Response> {
  requireSameOrigin(request);
  const context = await requireTenantAccess(env.DB, auth, clubId, "teams.manage");
  // Creating a team is a club-wide operation (it adds a whole new scope to the
  // club) — a membership limited to one existing team must not be able to
  // spin up another, even if its role happens to carry teams.manage.
  denyTeamScoped(context);
  const body = parseBody(await readJson(request, 8_192), {
    name: { kind: "string", min: 1, max: 120 },
    ageGroup: { kind: "string", max: 40, optional: true },
  });
  const name = body.name as string;
  const ageGroup = (body.ageGroup as string | undefined) ?? null;
  const id = newId();
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO teams (club_id,id,name,age_group,version,created_at,updated_at) VALUES (?,?,?,?,1,?,?)")
    .bind(context.clubId, id, name, ageGroup, now, now).run();
  await writeAudit(env.DB, { clubId: context.clubId, userId: auth.userId, action: "TEAM_CREATED", entityType: "team", entityId: id });
  return json({ team: { id, name, ageGroup, createdAt: now, updatedAt: now } }, requestId, 201);
}
