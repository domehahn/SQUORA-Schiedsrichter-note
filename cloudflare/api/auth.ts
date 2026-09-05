import { createSession, expiredSessionCookie, optionalAuth, requireAuth, revokeAllSessions, revokeSession, sha256 } from "../auth/session";
import { hashPassword, verifyPassword } from "../auth/password";
import { acceptStatements, resolvePendingInvitation } from "./invitations";
import { clientIp, enforceRateLimit } from "../core/rate-limit";
import { HttpError, json, readJson, requireSameOrigin } from "../core/http";
import { MOUNT_PATH } from "../core/mount-path";
import { newId } from "../core/id";
import { parseBody } from "../core/validation";
import { sendEmail } from "../services/email";
import { writeAudit } from "../services/audit-service";

const DUMMY_HASH = "pbkdf2-sha256$100000*6$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000";

function setCookie(response: Response, cookie: string): Response {
  const headers = new Headers(response.headers);
  headers.set("Set-Cookie", cookie);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function login(request: Request, env: Env, requestId: string): Promise<Response> {
  requireSameOrigin(request);
  const contentType = request.headers.get("Content-Type") ?? "";
  let email = "";
  let password = "";
  if (contentType.startsWith("application/json")) {
    const data = await readJson(request, 4096) as Record<string, unknown>;
    email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
    password = typeof data.password === "string" ? data.password : "";
  } else if (contentType.startsWith("application/x-www-form-urlencoded")) {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > 4096) throw new HttpError(413, "PAYLOAD_TOO_LARGE", "The request payload is too large.");
    const form = new URLSearchParams(new TextDecoder().decode(bytes));
    email = (form.get("email") ?? "").trim().toLowerCase();
    password = form.get("password") ?? "";
  } else {
    throw new HttpError(415, "CONTENT_TYPE_REQUIRED", "A supported content type is required.");
  }
  if (email.length > 254 || password.length > 1024) throw new HttpError(401, "INVALID_CREDENTIALS", "E-mail address or password is invalid.");
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const limited = await env.LOGIN_RATE_LIMITER.limit({ key: `${ip.slice(0, 64)}:${email || "unknown"}` });
  if (!limited.success) {
    await writeAudit(env.DB, { action: "LOGIN_RATE_LIMITED", entityType: "session", metadata: { ip: ip.slice(0, 64) } });
    throw new HttpError(429, "LOGIN_RATE_LIMITED", "Too many login attempts. Please try again later.");
  }

  const user = await env.DB.prepare("SELECT id,email,display_name AS displayName,password_hash AS passwordHash,status FROM users WHERE email=?")
    .bind(email).first<{ id: string; email: string; displayName: string; passwordHash: string; status: string }>();
  const { ok, needsRehash } = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || user.status !== "active" || !ok) {
    await writeAudit(env.DB, { userId: user?.id, action: "LOGIN_FAILED", entityType: "session" });
    throw new HttpError(401, "INVALID_CREDENTIALS", "E-mail address or password is invalid.");
  }

  const session = await createSession(env.DB, user.id, request);
  const now = new Date().toISOString();
  if (needsRehash) {
    // Opportunistic KDF upgrade on successful login; never fatal.
    try {
      await env.DB.prepare("UPDATE users SET password_hash=?,updated_at=? WHERE id=?").bind(await hashPassword(password), now, user.id).run();
    } catch { /* keep the old hash; retry next login */ }
  }
  await env.DB.prepare("UPDATE users SET last_login_at=?,updated_at=? WHERE id=?").bind(now, now, user.id).run();
  await writeAudit(env.DB, { userId: user.id, action: "LOGIN_SUCCESS", entityType: "session" });
  return setCookie(json({ user: { id: user.id, email: user.email, displayName: user.displayName } }, requestId), session.cookie);
}

/**
 * Register a brand-new account from an invitation token. The e-mail is taken
 * from the invitation, never from the request body — so a caller cannot claim
 * an address they were not invited under, and there is no account enumeration.
 * Creates (or activates) the user with a real password hash, activates the
 * membership and closes the invitation in one batch, then starts a session.
 */
export async function register(request: Request, env: Env, requestId: string): Promise<Response> {
  requireSameOrigin(request);
  await enforceRateLimit(env.LOGIN_RATE_LIMITER, [clientIp(request), "auth.register"]);
  const body = parseBody(await readJson(request, 8192), {
    token: { kind: "string", min: 20, max: 64 },
    displayName: { kind: "string", min: 1, max: 120 },
    password: { kind: "string", min: 12, max: 1024 },
  });
  const invite = await resolvePendingInvitation(env.DB, body.token as string);
  if (!invite) throw new HttpError(404, "NOT_FOUND", "The invitation is invalid or has expired.");

  const existing = await env.DB.prepare("SELECT id,status FROM users WHERE email=?").bind(invite.email).first<{ id: string; status: string }>();
  if (existing?.status === "active") throw new HttpError(409, "ACCOUNT_EXISTS", "An account already exists. Please sign in and accept the invitation.");

  const now = new Date().toISOString();
  const userId = existing?.id ?? newId();
  const passwordHash = await hashPassword(body.password as string);
  const membership = existing ? await env.DB.prepare("SELECT 1 FROM memberships WHERE club_id=? AND user_id=?").bind(invite.clubId, userId).first() : null;
  await env.DB.batch([
    existing
      ? env.DB.prepare("UPDATE users SET display_name=?,password_hash=?,status='active',updated_at=? WHERE id=?").bind(body.displayName, passwordHash, now, userId)
      : env.DB.prepare("INSERT INTO users (id,email,display_name,password_hash,status,created_at,updated_at) VALUES (?,?,?,?, 'active',?,?)").bind(userId, invite.email, body.displayName, passwordHash, now, now),
    ...acceptStatements(env.DB, invite, userId, Boolean(membership), now),
  ]);
  await writeAudit(env.DB, { userId, action: "USER_REGISTERED", entityType: "user", entityId: userId });
  await writeAudit(env.DB, { clubId: invite.clubId, userId, action: "INVITATION_ACCEPTED", entityType: "invitation", entityId: invite.id, metadata: { role: invite.role, teamScoped: Boolean(invite.teamId), viaRegistration: true } });

  const session = await createSession(env.DB, userId, request);
  return setCookie(json({ user: { id: userId, email: invite.email, displayName: body.displayName } }, requestId, 201), session.cookie);
}

export async function me(request: Request, env: Env, requestId: string): Promise<Response> {
  const auth = await requireAuth(request, env.DB);
  return json({ user: { id: auth.userId, email: auth.email, displayName: auth.displayName } }, requestId);
}

export async function logout(request: Request, env: Env, requestId: string, all = false): Promise<Response> {
  requireSameOrigin(request);
  const auth = await optionalAuth(request, env.DB);
  if (auth) {
    if (all) await revokeAllSessions(env.DB, auth.userId);
    else await revokeSession(env.DB, auth.sessionHash);
    await writeAudit(env.DB, { userId: auth.userId, action: "LOGOUT", entityType: "session", metadata: { all } });
  }
  return setCookie(json({ ok: true }, requestId), expiredSessionCookie());
}

const RESET_TTL_MS = 30 * 60 * 1000;
const GENERIC_RESET_MESSAGE = "Falls diese Adresse registriert ist, wurde eine E-Mail mit einem Link zum Zurücksetzen versendet.";

/** A URL-safe 256-bit token; only its SHA-256 is ever stored (same convention as invitations/live-share). */
function mintResetToken(): { token: string; tokenHashPromise: Promise<string> } {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const token = btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
  return { token, tokenHashPromise: sha256(token) };
}

/** Reads a JSON or form-urlencoded body into a plain object (mirrors login()'s dual handling — the reset pages are plain HTML forms, not the SPA). */
async function readFormOrJson(request: Request, maxBytes: number): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (contentType.startsWith("application/json")) return (await readJson(request, maxBytes)) as Record<string, unknown>;
  if (contentType.startsWith("application/x-www-form-urlencoded")) {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new HttpError(413, "PAYLOAD_TOO_LARGE", "The request payload is too large.");
    const form = new URLSearchParams(new TextDecoder().decode(bytes));
    return Object.fromEntries(form.entries());
  }
  throw new HttpError(415, "CONTENT_TYPE_REQUIRED", "A supported content type is required.");
}

/**
 * Request a password-reset link. Always returns the same generic response
 * regardless of whether the address is registered — no account enumeration.
 * If it is, a single-use token is minted and emailed; the raw token is never
 * logged, returned in the response, or stored (only its hash is). Email
 * delivery failing (e.g. RESEND_API_KEY not configured yet) does not change
 * the response, and is not fatal — it's logged server-side only.
 */
export async function forgotPassword(request: Request, env: Env, requestId: string): Promise<Response> {
  requireSameOrigin(request);
  await enforceRateLimit(env.LOGIN_RATE_LIMITER, [clientIp(request), "auth.forgot-password"]);
  const body = parseBody(await readFormOrJson(request, 2048), { email: { kind: "string", min: 3, max: 254 } });
  const email = (body.email as string).trim().toLowerCase();
  const generic = json({ ok: true, message: GENERIC_RESET_MESSAGE }, requestId);

  const user = await env.DB.prepare("SELECT id,email,display_name AS displayName FROM users WHERE email=? AND status='active'")
    .bind(email).first<{ id: string; email: string; displayName: string }>();
  if (!user) return generic;

  const { token, tokenHashPromise } = mintResetToken();
  const tokenHash = await tokenHashPromise;
  const now = new Date();
  await env.DB.prepare("INSERT INTO password_reset_tokens (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,?)")
    .bind(newId(), user.id, tokenHash, new Date(now.getTime() + RESET_TTL_MS).toISOString(), now.toISOString()).run();

  const resetUrl = `${new URL(request.url).origin}${MOUNT_PATH}/auth/reset-password?token=${token}`;
  const { sent } = await sendEmail(env, {
    to: user.email,
    subject: "Passwort zurücksetzen · SQUORA Schiedsrichter Note",
    text: `Hallo ${user.displayName},\n\nüber den folgenden Link kannst du dein Passwort zurücksetzen (30 Minuten gültig):\n${resetUrl}\n\nWenn du das nicht angefordert hast, kannst du diese E-Mail ignorieren.`,
    html: `<p>Hallo ${user.displayName},</p><p>über den folgenden Link kannst du dein Passwort zurücksetzen (30&nbsp;Minuten gültig):</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>Wenn du das nicht angefordert hast, kannst du diese E-Mail ignorieren.</p>`,
  });
  await writeAudit(env.DB, { userId: user.id, action: "PASSWORD_RESET_REQUESTED", entityType: "user", entityId: user.id, metadata: { emailSent: sent } });
  return generic;
}

/**
 * Complete a password reset. The token is single-use (marked used
 * immediately on success) and time-limited; every existing session for the
 * account is revoked so a token that leaked alongside an already-compromised
 * mailbox can't be replayed after the legitimate owner regains control.
 */
export async function resetPassword(request: Request, env: Env, requestId: string): Promise<Response> {
  requireSameOrigin(request);
  await enforceRateLimit(env.LOGIN_RATE_LIMITER, [clientIp(request), "auth.reset-password"]);
  const body = parseBody(await readFormOrJson(request, 2048), {
    token: { kind: "string", min: 20, max: 64 },
    password: { kind: "string", min: 12, max: 1024 },
  });
  const invalid = new HttpError(400, "INVALID_TOKEN", "This reset link is invalid or has expired.");
  const tokenHash = await sha256(body.token as string);
  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    `SELECT t.id,t.user_id AS userId FROM password_reset_tokens t JOIN users u ON u.id=t.user_id
     WHERE t.token_hash=? AND t.used_at IS NULL AND t.expires_at>? AND u.status='active'`,
  ).bind(tokenHash, now).first<{ id: string; userId: string }>();
  if (!row) throw invalid;

  const passwordHash = await hashPassword(body.password as string);
  await env.DB.batch([
    env.DB.prepare("UPDATE password_reset_tokens SET used_at=? WHERE id=?").bind(now, row.id),
    env.DB.prepare("UPDATE users SET password_hash=?,updated_at=? WHERE id=?").bind(passwordHash, now, row.userId),
  ]);
  await revokeAllSessions(env.DB, row.userId);
  await writeAudit(env.DB, { userId: row.userId, action: "PASSWORD_RESET_COMPLETED", entityType: "user", entityId: row.userId });
  return json({ ok: true }, requestId);
}

