import type { AuthContext } from "../auth/session";
import { sha256 } from "../auth/session";
import { isRole, ROLE_PERMISSIONS, type Role } from "../auth/roles";
import { clientIp, enforceRateLimit } from "../core/rate-limit";
import { HttpError, json, readJson, requireSameOrigin } from "../core/http";
import { isId, newId } from "../core/id";
import { parseBody } from "../core/validation";
import { denyTeamScoped, requireTenantAccess } from "../middleware/tenant";
import { writeAudit } from "../services/audit-service";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const NOT_FOUND = new HttpError(404, "NOT_FOUND", "The invitation is invalid or has expired.");

export interface PendingInvitation {
  clubId: string;
  id: string;
  email: string;
  role: Role;
  teamId: string | null;
  expiresAt: string;
}

/** A URL-safe 256-bit token; only its SHA-256 is ever stored. */
function mintToken(): { token: string; tokenHash: Promise<string> } {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const token = btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
  return { token, tokenHash: sha256(token) };
}

async function validateTeam(db: D1Database, clubId: string, teamId: unknown): Promise<string | null> {
  if (teamId === null || teamId === undefined || teamId === "") return null;
  if (typeof teamId !== "string" || !isId(teamId)) throw new HttpError(422, "VALIDATION_FAILED", "The request data is invalid.");
  const team = await db.prepare("SELECT 1 FROM teams WHERE club_id=? AND id=?").bind(clubId, teamId).first();
  if (!team) throw new HttpError(422, "VALIDATION_FAILED", "The request data is invalid.");
  return teamId;
}

/**
 * Look up a still-valid pending invitation by its raw token. Expired pending
 * rows are flipped to `expired` and treated as not found. Shared by the public
 * view, the authenticated accept and the registration flow — always via the
 * token hash, never by id or email.
 */
export async function resolvePendingInvitation(db: D1Database, token: string): Promise<(PendingInvitation & { clubName: string; teamName: string | null }) | null> {
  if (typeof token !== "string" || token.length < 20 || token.length > 64) return null;
  const tokenHash = await sha256(token);
  const row = await db.prepare(`SELECT i.club_id AS clubId, i.id, i.email, i.role, i.team_id AS teamId, i.expires_at AS expiresAt, i.status,
      c.name AS clubName, t.name AS teamName
    FROM invitations i JOIN clubs c ON c.id=i.club_id LEFT JOIN teams t ON t.club_id=i.club_id AND t.id=i.team_id
    WHERE i.token_hash=? AND c.status='active'`)
    .bind(tokenHash).first<PendingInvitation & { status: string; clubName: string; teamName: string | null }>();
  if (!row || row.status !== "pending") return null;
  if (Date.parse(row.expiresAt) <= Date.now()) {
    await db.prepare("UPDATE invitations SET status='expired',updated_at=? WHERE club_id=? AND id=? AND status='pending'")
      .bind(new Date().toISOString(), row.clubId, row.id).run();
    return null;
  }
  if (!isRole(row.role)) return null;
  return row;
}

/** Membership rows that make a new membership unnecessary or forbidden. */
async function existingMembership(db: D1Database, clubId: string, userId: string): Promise<{ status: string } | null> {
  return db.prepare("SELECT status FROM memberships WHERE club_id=? AND user_id=?").bind(clubId, userId).first<{ status: string }>();
}

/** Apply an accepted invitation: (up)sert an active membership and close the invite. One batch. */
export function acceptStatements(db: D1Database, invite: PendingInvitation, userId: string, hasMembership: boolean, now: string): D1PreparedStatement[] {
  return [
    hasMembership
      ? db.prepare("UPDATE memberships SET role=?,status='active',team_id=?,updated_at=? WHERE club_id=? AND user_id=?")
          .bind(invite.role, invite.teamId, now, invite.clubId, userId)
      : db.prepare("INSERT INTO memberships (club_id,user_id,role,status,created_at,updated_at,team_id) VALUES (?,?,?,'active',?,?,?)")
          .bind(invite.clubId, userId, invite.role, now, now, invite.teamId),
    db.prepare("UPDATE invitations SET status='accepted',accepted_at=?,updated_at=? WHERE club_id=? AND id=? AND status='pending'")
      .bind(now, now, invite.clubId, invite.id),
  ];
}

// ---- admin endpoints -------------------------------------------------------

export async function createInvitation(request: Request, env: Env, auth: AuthContext, clubId: string, requestId: string): Promise<Response> {
  requireSameOrigin(request);
  const context = await requireTenantAccess(env.DB, auth, clubId, "members.manage");
  denyTeamScoped(context);
  const body = parseBody(await readJson(request, 16_384), {
    email: { kind: "string", min: 3, max: 254 },
    role: { kind: "string", min: 1, max: 40 },
    teamId: { kind: "id", optional: true },
  });
  const email = (body.email as string).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(422, "VALIDATION_FAILED", "The request data is invalid.");
  const role = body.role as string;
  if (!isRole(role) || role === "club_owner") throw new HttpError(422, "VALIDATION_FAILED", "The request data is invalid.");
  const teamId = await validateTeam(env.DB, context.clubId, body.teamId);

  const clash = await env.DB.prepare(`SELECT m.status FROM memberships m JOIN users u ON u.id=m.user_id
    WHERE m.club_id=? AND u.email=? AND m.status='active'`).bind(context.clubId, email).first();
  if (clash) throw new HttpError(409, "MEMBERSHIP_EXISTS", "That account is already an active member of this club.");

  const now = new Date().toISOString();
  const id = newId();
  const { token, tokenHash } = mintToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE invitations SET status='revoked',revoked_at=?,updated_at=? WHERE club_id=? AND email=? AND status='pending'").bind(now, now, context.clubId, email),
    env.DB.prepare("INSERT INTO invitations (club_id,id,email,role,team_id,token_hash,status,expires_at,invited_by,created_at,updated_at) VALUES (?,?,?,?,?,?, 'pending',?,?,?,?)")
      .bind(context.clubId, id, email, role, teamId, await tokenHash, expiresAt, auth.userId, now, now),
  ]);
  await writeAudit(env.DB, { clubId: context.clubId, userId: auth.userId, action: "INVITATION_CREATED", entityType: "invitation", entityId: id, metadata: { role, teamScoped: Boolean(teamId), expiresAt } });
  return json({ invitation: { id, email, role, teamId, status: "pending", expiresAt }, token }, requestId, 201);
}

export async function listInvitations(request: Request, env: Env, auth: AuthContext, clubId: string, requestId: string): Promise<Response> {
  const context = await requireTenantAccess(env.DB, auth, clubId, "members.read");
  denyTeamScoped(context);
  const limit = Math.min(Math.max(Number(new URL(request.url).searchParams.get("limit") ?? 50) || 50, 1), 100);
  const rows = await env.DB.prepare(`SELECT id,email,role,team_id AS teamId,status,expires_at AS expiresAt,accepted_at AS acceptedAt,created_at AS createdAt
    FROM invitations WHERE club_id=? ORDER BY created_at DESC,id LIMIT ?`).bind(context.clubId, limit).all();
  return json({ invitations: rows.results }, requestId);
}

export async function revokeInvitation(request: Request, env: Env, auth: AuthContext, clubId: string, invitationId: string, requestId: string): Promise<Response> {
  requireSameOrigin(request);
  const context = await requireTenantAccess(env.DB, auth, clubId, "members.manage");
  denyTeamScoped(context);
  if (!isId(invitationId)) throw new HttpError(404, "NOT_FOUND", "The requested resource was not found.");
  const now = new Date().toISOString();
  const result = await env.DB.prepare("UPDATE invitations SET status='revoked',revoked_at=?,updated_at=? WHERE club_id=? AND id=? AND status='pending'")
    .bind(now, now, context.clubId, invitationId).run();
  if (result.meta.changes !== 1) throw new HttpError(404, "NOT_FOUND", "The requested resource was not found.");
  await writeAudit(env.DB, { clubId: context.clubId, userId: auth.userId, action: "INVITATION_REVOKED", entityType: "invitation", entityId: invitationId });
  return json({ ok: true }, requestId);
}

// ---- public / accept -----------------------------------------------------

export async function viewInvitation(request: Request, env: Env, token: string, requestId: string): Promise<Response> {
  await enforceRateLimit(env.LOGIN_RATE_LIMITER, [clientIp(request), "invitation.view"]);
  const invite = await resolvePendingInvitation(env.DB, token);
  if (!invite) throw NOT_FOUND;
  return json({ invitation: { clubName: invite.clubName, role: invite.role, teamName: invite.teamName, expiresAt: invite.expiresAt } }, requestId);
}

export async function acceptInvitation(request: Request, env: Env, auth: AuthContext, requestId: string): Promise<Response> {
  requireSameOrigin(request);
  await enforceRateLimit(env.LOGIN_RATE_LIMITER, [clientIp(request), auth.userId, "invitation.accept"]);
  const token = parseBody(await readJson(request, 4096), { token: { kind: "string", min: 20, max: 64 } }).token as string;
  const invite = await resolvePendingInvitation(env.DB, token);
  if (!invite) throw NOT_FOUND;
  if (auth.email.toLowerCase() !== invite.email.toLowerCase()) {
    throw new HttpError(403, "EMAIL_MISMATCH", "This invitation was issued for a different e-mail address.");
  }
  const membership = await existingMembership(env.DB, invite.clubId, auth.userId);
  if (membership?.status === "active") throw new HttpError(409, "MEMBERSHIP_EXISTS", "You are already an active member of this club.");
  const now = new Date().toISOString();
  await env.DB.batch(acceptStatements(env.DB, invite, auth.userId, Boolean(membership), now));
  await writeAudit(env.DB, { clubId: invite.clubId, userId: auth.userId, action: "INVITATION_ACCEPTED", entityType: "invitation", entityId: invite.id, metadata: { role: invite.role, teamScoped: Boolean(invite.teamId) } });
  return json({ club: { id: invite.clubId, name: invite.clubName }, membership: { role: invite.role, teamId: invite.teamId, permissions: ROLE_PERMISSIONS[invite.role] } }, requestId, 201);
}
