import { HttpError } from "../core/http";

export const SESSION_COOKIE = "squora_session";
export const SESSION_SECONDS = 8 * 60 * 60;
const encoder = new TextEncoder();

export interface AuthContext {
  userId: string;
  email: string;
  displayName: string;
  sessionHash: string;
}

function base64Url(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export async function sha256(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function cookieValue(request: Request, name: string): string | null {
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator >= 0 && part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

export async function createSession(db: D1Database, userId: string, request: Request): Promise<{ token: string; cookie: string }> {
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  const token = base64Url(raw);
  const idHash = await sha256(token);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_SECONDS * 1000);
  const userAgent = (request.headers.get("User-Agent") ?? "").slice(0, 300) || null;
  await db.prepare("INSERT INTO sessions (id_hash,user_id,created_at,last_seen_at,expires_at,user_agent) VALUES (?,?,?,?,?,?)")
    .bind(idHash, userId, now.toISOString(), now.toISOString(), expires.toISOString(), userAgent).run();
  return {
    token,
    cookie: `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`,
  };
}

export function expiredSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

export async function optionalAuth(request: Request, db: D1Database): Promise<AuthContext | null> {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token || token.length > 256) return null;
  const sessionHash = await sha256(token);
  const now = new Date().toISOString();
  const row = await db.prepare(`SELECT u.id AS userId,u.email,u.display_name AS displayName,s.last_seen_at AS lastSeenAt
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.id_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND u.status='active'`)
    .bind(sessionHash, now).first<{ userId: string; email: string; displayName: string; lastSeenAt: string }>();
  if (!row) return null;
  if (Date.now() - Date.parse(row.lastSeenAt) > 5 * 60 * 1000) {
    await db.prepare("UPDATE sessions SET last_seen_at=? WHERE id_hash=?").bind(now, sessionHash).run();
  }
  return { userId: row.userId, email: row.email, displayName: row.displayName, sessionHash };
}

export async function requireAuth(request: Request, db: D1Database): Promise<AuthContext> {
  const auth = await optionalAuth(request, db);
  if (!auth) throw new HttpError(401, "AUTHENTICATION_REQUIRED", "Authentication is required.");
  return auth;
}

export async function revokeSession(db: D1Database, sessionHash: string): Promise<void> {
  await db.prepare("UPDATE sessions SET revoked_at=? WHERE id_hash=? AND revoked_at IS NULL").bind(new Date().toISOString(), sessionHash).run();
}

export async function revokeAllSessions(db: D1Database, userId: string): Promise<void> {
  await db.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL").bind(new Date().toISOString(), userId).run();
}

