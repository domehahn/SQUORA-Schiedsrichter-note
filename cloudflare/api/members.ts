import type { AuthContext } from "../auth/session";
import { isRole, type Role } from "../auth/roles";
import { HttpError, json, readJson, requireSameOrigin } from "../core/http";
import { isId, newId } from "../core/id";
import { objectValue, stringValue } from "../core/validation";
import { denyTeamScoped, requireTenantAccess } from "../middleware/tenant";
import { writeAudit } from "../services/audit-service";

const DUMMY_HASH = "pbkdf2-sha256$100000*6$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000";
type MembershipStatus = "invited" | "active" | "suspended" | "removed";

function membershipStatus(value: unknown): value is MembershipStatus {
  return value === "invited" || value === "active" || value === "suspended" || value === "removed";
}

async function managerContext(env: Env, auth: AuthContext, clubId: string) {
  const context = await requireTenantAccess(env.DB, auth, clubId, "members.manage");
  denyTeamScoped(context);
  return context;
}

async function validateTeam(db: D1Database, clubId: string, teamId: unknown): Promise<string | null> {
  if (teamId === null || teamId === undefined || teamId === "") return null;
  if (typeof teamId !== "string" || !isId(teamId)) throw new HttpError(422, "VALIDATION_FAILED", "The request data is invalid.");
  const team = await db.prepare("SELECT 1 FROM teams WHERE club_id=? AND id=?").bind(clubId, teamId).first();
  if (!team) throw new HttpError(422, "VALIDATION_FAILED", "The request data is invalid.");
  return teamId;
}

async function activeOwnerCount(db: D1Database, clubId: string): Promise<number> {
  return (await db.prepare("SELECT COUNT(*) AS count FROM memberships WHERE club_id=? AND role='club_owner' AND status='active'").bind(clubId).first<{ count: number }>())?.count ?? 0;
}

export async function listMembers(request: Request, env: Env, auth: AuthContext, clubId: string, requestId: string): Promise<Response> {
  const context = await requireTenantAccess(env.DB, auth, clubId, "members.read");
  denyTeamScoped(context);
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50) || 50, 1), 100);
  const cursor = url.searchParams.get("cursor");
  if (cursor && !isId(cursor)) throw new HttpError(400, "INVALID_CURSOR", "The pagination cursor is invalid.");
  const query = cursor
    ? env.DB.prepare(`SELECT u.id AS userId,u.email,u.display_name AS displayName,u.status AS userStatus,m.role,m.status,m.team_id AS teamId,m.created_at AS createdAt,m.updated_at AS updatedAt
      FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.club_id=? AND u.id>? ORDER BY u.id LIMIT ?`).bind(context.clubId, cursor, limit + 1)
    : env.DB.prepare(`SELECT u.id AS userId,u.email,u.display_name AS displayName,u.status AS userStatus,m.role,m.status,m.team_id AS teamId,m.created_at AS createdAt,m.updated_at AS updatedAt
      FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.club_id=? ORDER BY u.id LIMIT ?`).bind(context.clubId, limit + 1);
  const result = await query.all<Record<string, unknown> & { userId: string }>();
  const members = result.results.slice(0, limit);
  return json({ members, nextCursor: result.results.length > limit ? members.at(-1)?.userId ?? null : null }, requestId);
}

export async function inviteMember(request: Request, env: Env, auth: AuthContext, clubId: string, requestId: string): Promise<Response> {
  requireSameOrigin(request);
  const context = await managerContext(env, auth, clubId);
  const body = objectValue(await readJson(request, 16_384));
  const email = stringValue(body, "email", { min: 3, max: 254 })!.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) throw new HttpError(422, "VALIDATION_FAILED", "The request data is invalid.");
  const displayName = stringValue(body, "displayName", { min: 1, max: 120 })!;
  const role = body.role;
  if (!isRole(role) || role === "club_owner") throw new HttpError(422, "VALIDATION_FAILED", "The request data is invalid.");
  const teamId = await validateTeam(env.DB, context.clubId, body.teamId);
  const now = new Date().toISOString();
  let user = await env.DB.prepare("SELECT id,status FROM users WHERE email=?").bind(email).first<{ id: string; status: string }>();
  if (!user) {
    user = { id: newId(), status: "invited" };
    await env.DB.prepare("INSERT INTO users (id,email,display_name,password_hash,status,created_at,updated_at) VALUES (?,?,?,?, 'invited',?,?)")
      .bind(user.id, email, displayName, DUMMY_HASH, now, now).run();
  }
  const existing = await env.DB.prepare("SELECT status FROM memberships WHERE club_id=? AND user_id=?").bind(context.clubId, user.id).first();
  if (existing) throw new HttpError(409, "MEMBERSHIP_EXISTS", "A membership already exists for this account.");
  const status: MembershipStatus = user.status === "active" ? "active" : "invited";
  await env.DB.prepare("INSERT INTO memberships (club_id,user_id,role,status,created_at,updated_at,team_id) VALUES (?,?,?,?,?,?,?)")
    .bind(context.clubId, user.id, role, status, now, now, teamId).run();
  await writeAudit(env.DB, { clubId: context.clubId, userId: auth.userId, action: "MEMBER_INVITED", entityType: "membership", entityId: user.id, metadata: { role, teamScoped: Boolean(teamId) } });
  return json({ member: { userId: user.id, email, displayName, role, status, teamId } }, requestId, 201);
}

export async function updateMember(request: Request, env: Env, auth: AuthContext, clubId: string, userId: string, requestId: string): Promise<Response> {
  requireSameOrigin(request);
  const context = await managerContext(env, auth, clubId);
  if (!isId(userId)) throw new HttpError(404, "NOT_FOUND", "The requested resource was not found.");
  const current = await env.DB.prepare("SELECT role,status,team_id AS teamId FROM memberships WHERE club_id=? AND user_id=?").bind(context.clubId, userId).first<{ role: Role; status: MembershipStatus; teamId: string | null }>();
  if (!current) throw new HttpError(404, "NOT_FOUND", "The requested resource was not found.");
  const body = objectValue(await readJson(request, 16_384));
  const role = body.role === undefined ? current.role : body.role;
  const status = body.status === undefined ? current.status : body.status;
  if (!isRole(role) || !membershipStatus(status)) throw new HttpError(422, "VALIDATION_FAILED", "The request data is invalid.");
  if (current.role === "club_owner" && context.role !== "club_owner") throw new HttpError(403, "PERMISSION_DENIED", "Only a club owner can change another owner.");
  if (role === "club_owner" && context.role !== "club_owner") throw new HttpError(403, "PERMISSION_DENIED", "Only a club owner can assign ownership.");
  const teamId = body.teamId === undefined ? current.teamId : await validateTeam(env.DB, context.clubId, body.teamId);
  if (role === "club_owner" && teamId) throw new HttpError(422, "VALIDATION_FAILED", "A club owner cannot be limited to one team.");
  if (current.role === "club_owner" && current.status === "active" && (role !== "club_owner" || status !== "active") && await activeOwnerCount(env.DB, context.clubId) <= 1) {
    throw new HttpError(409, "LAST_OWNER", "The last active club owner cannot be removed.");
  }
  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE memberships SET role=?,status=?,team_id=?,updated_at=? WHERE club_id=? AND user_id=?")
    .bind(role, status, teamId, now, context.clubId, userId).run();
  if (role !== current.role) await writeAudit(env.DB, { clubId: context.clubId, userId: auth.userId, action: "MEMBER_ROLE_CHANGED", entityType: "membership", entityId: userId, metadata: { from: current.role, to: role } });
  if (status !== current.status) await writeAudit(env.DB, { clubId: context.clubId, userId: auth.userId, action: status === "removed" ? "MEMBER_REMOVED" : "MEMBER_STATUS_CHANGED", entityType: "membership", entityId: userId, metadata: { from: current.status, to: status } });
  return json({ member: { userId, role, status, teamId, updatedAt: now } }, requestId);
}

export async function removeMember(request: Request, env: Env, auth: AuthContext, clubId: string, userId: string, requestId: string): Promise<Response> {
  requireSameOrigin(request);
  const context = await managerContext(env, auth, clubId);
  if (!isId(userId)) throw new HttpError(404, "NOT_FOUND", "The requested resource was not found.");
  const current = await env.DB.prepare("SELECT role,status FROM memberships WHERE club_id=? AND user_id=?").bind(context.clubId, userId).first<{ role: Role; status: MembershipStatus }>();
  if (!current) throw new HttpError(404, "NOT_FOUND", "The requested resource was not found.");
  if (current.role === "club_owner" && context.role !== "club_owner") throw new HttpError(403, "PERMISSION_DENIED", "Only a club owner can remove another owner.");
  if (current.role === "club_owner" && current.status === "active" && await activeOwnerCount(env.DB, context.clubId) <= 1) throw new HttpError(409, "LAST_OWNER", "The last active club owner cannot be removed.");
  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE memberships SET status='removed',updated_at=? WHERE club_id=? AND user_id=?").bind(now, context.clubId, userId).run();
  await writeAudit(env.DB, { clubId: context.clubId, userId: auth.userId, action: "MEMBER_REMOVED", entityType: "membership", entityId: userId, metadata: { from: current.status } });
  return json({ ok: true }, requestId);
}
