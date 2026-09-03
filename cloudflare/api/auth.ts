import { createSession, expiredSessionCookie, optionalAuth, requireAuth, revokeAllSessions, revokeSession } from "../auth/session";
import { verifyPassword } from "../auth/password";
import { HttpError, json, readJson, requireSameOrigin } from "../core/http";
import { writeAudit } from "../services/audit-service";

const DUMMY_HASH = "pbkdf2-sha256$600000$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000";

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
  if (!limited.success) throw new HttpError(429, "LOGIN_RATE_LIMITED", "Too many login attempts. Please try again later.");

  const user = await env.DB.prepare("SELECT id,email,display_name AS displayName,password_hash AS passwordHash,status FROM users WHERE email=?")
    .bind(email).first<{ id: string; email: string; displayName: string; passwordHash: string; status: string }>();
  const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || user.status !== "active" || !valid) {
    await writeAudit(env.DB, { userId: user?.id, action: "LOGIN_FAILED", entityType: "session" });
    throw new HttpError(401, "INVALID_CREDENTIALS", "E-mail address or password is invalid.");
  }

  const session = await createSession(env.DB, user.id, request);
  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE users SET last_login_at=?,updated_at=? WHERE id=?").bind(now, now, user.id).run();
  await writeAudit(env.DB, { userId: user.id, action: "LOGIN_SUCCESS", entityType: "session" });
  return setCookie(json({ user: { id: user.id, email: user.email, displayName: user.displayName } }, requestId), session.cookie);
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

