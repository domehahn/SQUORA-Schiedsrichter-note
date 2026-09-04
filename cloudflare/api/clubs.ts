import type { AuthContext } from "../auth/session";
import { ROLE_PERMISSIONS, type Role } from "../auth/roles";
import { HttpError, json, readJson, requireSameOrigin } from "../core/http";
import { newId } from "../core/id";
import { parseBody } from "../core/validation";
import { denyTeamScoped, requireTenantAccess } from "../middleware/tenant";
import { writeAudit } from "../services/audit-service";

function randomSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function slugify(name: string): string {
  const base = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
  return `${base || "club"}-${newId().slice(0, 8)}`;
}

export async function listClubs(env: Env, auth: AuthContext, requestId: string): Promise<Response> {
  const result = await env.DB.prepare(`SELECT c.id,c.name,c.slug,c.cache_salt AS cacheSalt,m.role
    FROM memberships m JOIN clubs c ON c.id=m.club_id
    WHERE m.user_id=? AND m.status='active' AND c.status='active' ORDER BY c.name,c.id`).bind(auth.userId).all<{
      id: string; name: string; slug: string; cacheSalt: string; role: Role;
    }>();
  return json({ clubs: result.results.map((club) => ({ ...club, permissions: ROLE_PERMISSIONS[club.role] })) }, requestId);
}

export async function createClub(request: Request, env: Env, auth: AuthContext, requestId: string): Promise<Response> {
  requireSameOrigin(request);
  const name = parseBody(await readJson(request, 16_384), { name: { kind: "string", min: 1, max: 120 } }).name as string;
  const id = newId();
  const now = new Date().toISOString();
  const slug = slugify(name);
  const cacheSalt = randomSalt();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO clubs (id,name,slug,cache_salt,status,created_at,updated_at) VALUES (?,?,?,?, 'active',?,?)").bind(id, name, slug, cacheSalt, now, now),
    env.DB.prepare("INSERT INTO memberships (club_id,user_id,role,status,created_at,updated_at) VALUES (?,?,'club_owner','active',?,?)").bind(id, auth.userId, now, now),
  ]);
  await writeAudit(env.DB, { clubId: id, userId: auth.userId, action: "CLUB_CREATED", entityType: "club", entityId: id });
  return json({ club: { id, name, slug, cacheSalt, role: "club_owner", permissions: ROLE_PERMISSIONS.club_owner } }, requestId, 201);
}

export async function getClub(env: Env, auth: AuthContext, clubId: string, requestId: string): Promise<Response> {
  const context = await requireTenantAccess(env.DB, auth, clubId, "club.read");
  const club = await env.DB.prepare("SELECT id,name,slug,dfb_club_id AS dfbClubId,cache_salt AS cacheSalt,status,created_at AS createdAt,updated_at AS updatedAt FROM clubs WHERE id=? AND status='active'")
    .bind(context.clubId).first();
  if (!club) throw new HttpError(404, "NOT_FOUND", "The requested resource was not found.");
  return json({ club: { ...club, role: context.role, permissions: context.permissions } }, requestId);
}

const GRACE_DAYS = 30;

/**
 * Schedules a club for deletion after a 30-day grace window. Only a `club_owner`
 * may do this and the body must confirm the exact club name. The club moves to
 * `status='deleted'` with `deletion_due_at` set — it disappears from every
 * tenant query immediately, the owner can still cancel, and the daily cron
 * hard-deletes it (purgeClub) once the window elapses.
 */
export async function deleteClub(request: Request, env: Env, auth: AuthContext, clubId: string, requestId: string): Promise<Response> {
  requireSameOrigin(request);
  const context = await requireTenantAccess(env.DB, auth, clubId, "club.manage");
  denyTeamScoped(context);
  if (context.role !== "club_owner") throw new HttpError(403, "PERMISSION_DENIED", "Only the club owner can delete the club.");
  const club = await env.DB.prepare("SELECT name FROM clubs WHERE id=?").bind(context.clubId).first<{ name: string }>();
  if (!club) throw new HttpError(404, "NOT_FOUND", "The requested resource was not found.");
  const confirm = parseBody(await readJson(request, 4096), { confirm: { kind: "string", max: 120 } }).confirm as string;
  if (confirm !== club.name) throw new HttpError(422, "CONFIRMATION_MISMATCH", "The confirmation does not match the club name.");
  const now = new Date();
  const dueAt = new Date(now.getTime() + GRACE_DAYS * 86_400_000).toISOString();
  await env.DB.prepare("UPDATE clubs SET status='deleted',deletion_due_at=?,updated_at=? WHERE id=? AND status='active'")
    .bind(dueAt, now.toISOString(), context.clubId).run();
  await writeAudit(env.DB, { clubId: context.clubId, userId: auth.userId, action: "CLUB_DELETION_SCHEDULED", entityType: "club", entityId: context.clubId, metadata: { clubId: context.clubId, name: club.name, dueAt } });
  return json({ ok: true, deletionDueAt: dueAt }, requestId);
}

/** Cancels a scheduled club deletion. Owner only; the club is not `active` right now. */
export async function cancelClubDeletion(request: Request, env: Env, auth: AuthContext, clubId: string, requestId: string): Promise<Response> {
  requireSameOrigin(request);
  const membership = await env.DB.prepare("SELECT role FROM memberships WHERE club_id=? AND user_id=? AND status='active'")
    .bind(clubId, auth.userId).first<{ role: Role }>();
  if (!membership) throw new HttpError(404, "NOT_FOUND", "The requested resource was not found.");
  if (membership.role !== "club_owner") throw new HttpError(403, "PERMISSION_DENIED", "Only the club owner can cancel deletion.");
  const restored = await env.DB.prepare("UPDATE clubs SET status='active',deletion_due_at=NULL,updated_at=? WHERE id=? AND status='deleted' AND deletion_due_at IS NOT NULL")
    .bind(new Date().toISOString(), clubId).run();
  if (restored.meta.changes !== 1) throw new HttpError(404, "NOT_FOUND", "The requested resource was not found.");
  await writeAudit(env.DB, { clubId, userId: auth.userId, action: "CLUB_DELETION_CANCELLED", entityType: "club", entityId: clubId });
  return json({ ok: true }, requestId);
}
