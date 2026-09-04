import type { AuthContext } from "../auth/session";
import { ROLE_PERMISSIONS, type Role } from "../auth/roles";
import { HttpError, json, readJson, requireSameOrigin } from "../core/http";
import { newId } from "../core/id";
import { parseBody } from "../core/validation";
import { denyTeamScoped, requireTenantAccess } from "../middleware/tenant";
import { purgeClub } from "../services/club-deletion";
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

/**
 * Hard-deletes a club and every row scoped to it. Only a `club_owner` may do
 * this and the request body must confirm the exact club name. The audit row is
 * written before the purge and keeps the club id/name in metadata (its own
 * `club_id` column is nulled by the cascade).
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
  await writeAudit(env.DB, { clubId: context.clubId, userId: auth.userId, action: "CLUB_DELETED", entityType: "club", entityId: context.clubId, metadata: { clubId: context.clubId, name: club.name } });
  const counts = await purgeClub(env.DB, context.clubId);
  return json({ ok: true, deleted: counts }, requestId);
}
