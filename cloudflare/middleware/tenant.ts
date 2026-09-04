import type { AuthContext } from "../auth/session";
import type { Permission } from "../auth/permissions";
import { ROLE_PERMISSIONS, type Role } from "../auth/roles";
import { HttpError } from "../core/http";
import { isId } from "../core/id";

export interface TenantContext extends AuthContext {
  clubId: string;
  role: Role;
  permissions: readonly Permission[];
  /** Set when the caller's membership is limited to one team; null for club-wide members. */
  scopedTeamId: string | null;
}

export interface TeamContext extends TenantContext {
  teamId: string;
}

const NOT_FOUND = new HttpError(404, "NOT_FOUND", "The requested resource was not found.");

export async function requireTenantAccess(db: D1Database, auth: AuthContext, clubId: string, permission: Permission): Promise<TenantContext> {
  if (!isId(clubId)) throw NOT_FOUND;
  const membership = await db.prepare(`SELECT m.role, m.team_id AS teamId FROM memberships m JOIN clubs c ON c.id=m.club_id
    WHERE m.club_id=? AND m.user_id=? AND m.status='active' AND c.status='active'`)
    .bind(clubId, auth.userId).first<{ role: Role; teamId: string | null }>();
  if (!membership || !Object.hasOwn(ROLE_PERMISSIONS, membership.role)) throw NOT_FOUND;
  const permissions = ROLE_PERMISSIONS[membership.role];
  if (!permissions.includes(permission)) throw new HttpError(403, "PERMISSION_DENIED", "You do not have permission for this action.");
  return { ...auth, clubId, role: membership.role, permissions, scopedTeamId: membership.teamId ?? null };
}

/**
 * Club-wide endpoints (the flat /clubs/:id/matches list, club export) must not be
 * reachable by a team-scoped membership — it would see every team's data. Such a
 * caller has to go through the team-scoped routes instead; hide the endpoint (404).
 */
export function denyTeamScoped(context: TenantContext): void {
  if (context.scopedTeamId) throw NOT_FOUND;
}

/**
 * Authorizes access to one team (Jugend) within a club. A membership scoped to a
 * team (team_id set) may only reach that team; a club-wide membership (team_id NULL)
 * reaches every team of the club. The team must exist.
 */
export async function requireTeamAccess(db: D1Database, auth: AuthContext, clubId: string, teamId: string, permission: Permission): Promise<TeamContext> {
  if (!isId(clubId) || !isId(teamId)) throw NOT_FOUND;
  const membership = await db.prepare(`SELECT m.role, m.team_id AS teamId FROM memberships m JOIN clubs c ON c.id=m.club_id
    WHERE m.club_id=? AND m.user_id=? AND m.status='active' AND c.status='active' AND (m.team_id IS NULL OR m.team_id=?)`)
    .bind(clubId, auth.userId, teamId).first<{ role: Role; teamId: string | null }>();
  if (!membership || !Object.hasOwn(ROLE_PERMISSIONS, membership.role)) throw NOT_FOUND;
  const team = await db.prepare("SELECT 1 FROM teams WHERE club_id=? AND id=?").bind(clubId, teamId).first();
  if (!team) throw NOT_FOUND;
  const permissions = ROLE_PERMISSIONS[membership.role];
  if (!permissions.includes(permission)) throw new HttpError(403, "PERMISSION_DENIED", "You do not have permission for this action.");
  return { ...auth, clubId, teamId, role: membership.role, permissions, scopedTeamId: membership.teamId ?? null };
}

