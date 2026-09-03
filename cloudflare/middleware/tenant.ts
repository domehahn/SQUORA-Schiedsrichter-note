import type { AuthContext } from "../auth/session";
import type { Permission } from "../auth/permissions";
import { ROLE_PERMISSIONS, type Role } from "../auth/roles";
import { HttpError } from "../core/http";
import { isId } from "../core/id";

export interface TenantContext extends AuthContext {
  clubId: string;
  role: Role;
  permissions: readonly Permission[];
}

export async function requireTenantAccess(db: D1Database, auth: AuthContext, clubId: string, permission: Permission): Promise<TenantContext> {
  if (!isId(clubId)) throw new HttpError(404, "NOT_FOUND", "The requested resource was not found.");
  const membership = await db.prepare(`SELECT m.role FROM memberships m JOIN clubs c ON c.id=m.club_id
    WHERE m.club_id=? AND m.user_id=? AND m.status='active' AND c.status='active'`)
    .bind(clubId, auth.userId).first<{ role: Role }>();
  if (!membership || !Object.hasOwn(ROLE_PERMISSIONS, membership.role)) throw new HttpError(404, "NOT_FOUND", "The requested resource was not found.");
  const permissions = ROLE_PERMISSIONS[membership.role];
  if (!permissions.includes(permission)) throw new HttpError(403, "PERMISSION_DENIED", "You do not have permission for this action.");
  return { ...auth, clubId, role: membership.role, permissions };
}

