import type { AuthContext } from "../auth/session";
import { HttpError, json } from "../core/http";

/**
 * Read-only compatibility source for the controlled KV -> D1 migration.
 * Legacy keys are never treated as proof of club membership.
 */
export async function readLegacy(request: Request, env: Env, auth: AuthContext, relativePath: string, requestId: string): Promise<Response> {
  const prefix = `note:${auth.email.toLowerCase()}`;
  if (request.method !== "GET") throw new HttpError(410, "LEGACY_READ_ONLY", "Legacy storage is read-only during migration.");
  if (relativePath === "/api/archive") {
    const value = await env.LEGACY_DATA.get(prefix);
    return value ? new Response(value, { headers: { "Content-Type": "application/json; charset=utf-8" } }) : json({ updatedAt: null, archive: [], deletedIds: [], tournaments: [], teams: [], current: null }, requestId);
  }
  if (relativePath === "/api/tenants") {
    const value = await env.LEGACY_DATA.get(`${prefix}:index`);
    return value ? new Response(value, { headers: { "Content-Type": "application/json; charset=utf-8" } }) : json({ updatedAt: null, tenants: [] }, requestId);
  }
  throw new HttpError(404, "NOT_FOUND", "The requested resource was not found.");
}

