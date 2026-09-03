import { listClubs, createClub, getClub } from "./api/clubs";
import { login, logout, me } from "./api/auth";
import { createMatch, deleteMatch, getMatch, listMatches, updateMatch } from "./api/matches";
import { requireAuth, type AuthContext } from "./auth/session";
import { errorResponse, HttpError, recordRequest, SECURITY_HEADERS, withHeaders } from "./core/http";
import { readLegacy } from "./legacy/kv-migration";

const LEGACY_PREFIX = "/schiedsrichter-note";

function relativePath(pathname: string): string {
  return pathname === LEGACY_PREFIX ? "/" : pathname.startsWith(`${LEGACY_PREFIX}/`) ? pathname.slice(LEGACY_PREFIX.length) : pathname;
}

function loginHtml(error = ""): string {
  const message = error ? `<div class="error" role="alert">${error}</div>` : "";
  return `<!doctype html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0b2559"><title>Anmelden · SQUORA Schiedsrichter Note</title><link rel="stylesheet" href="/login.css"></head><body><main><div class="brand"><strong>SQUORA</strong><small>Schiedsrichter Note</small></div><span class="eyebrow">Geschützter Bereich</span><h1>Willkommen zurück</h1><p>Melde dich an, um deine digitale Spielnotiz zu öffnen.</p>${message}<form method="post" action="/auth/login"><label for="email">E-Mail-Adresse</label><input id="email" name="email" type="email" autocomplete="username" maxlength="254" required autofocus><label for="password">Passwort</label><input id="password" name="password" type="password" autocomplete="current-password" maxlength="1024" required><button type="submit">Anmelden</button></form></main></body></html>`;
}

function loginPage(requestId: string, error = "", status = 200): Response {
  return withHeaders(new Response(loginHtml(error), { status, headers: { "Content-Type": "text/html; charset=utf-8" } }), requestId, true);
}

function redirect(location: string, requestId: string, cookie?: string): Response {
  const headers = new Headers({ Location: location });
  if (cookie) headers.set("Set-Cookie", cookie);
  return withHeaders(new Response(null, { status: 303, headers }), requestId, true);
}

async function formLogin(request: Request, env: Env, requestId: string): Promise<Response> {
  try {
    const response = await login(request, env, requestId);
    return redirect("/", requestId, response.headers.get("Set-Cookie") ?? undefined);
  } catch (error) {
    if (error instanceof HttpError && (error.status === 401 || error.status === 429)) return loginPage(requestId, error.message, error.status);
    throw error;
  }
}

function isApi(path: string): boolean {
  return path.startsWith("/api/") || path.startsWith("/auth/");
}

function methodNotAllowed(): never {
  throw new HttpError(405, "METHOD_NOT_ALLOWED", "The method is not allowed.");
}

async function routeAuthenticated(request: Request, env: Env, auth: AuthContext, path: string, requestId: string): Promise<Response> {
  if (path === "/api/v1/me" && request.method === "GET") return me(request, env, requestId);
  if (path === "/api/v1/auth/logout" && request.method === "POST") return logout(request, env, requestId);
  if (path === "/api/v1/auth/logout-all" && request.method === "POST") return logout(request, env, requestId, true);
  if (path === "/auth/logout" && request.method === "POST") {
    const response = await logout(request, env, requestId);
    return redirect("/", requestId, response.headers.get("Set-Cookie") ?? undefined);
  }
  if (path === "/api/v1/clubs") {
    if (request.method === "GET") return listClubs(env, auth, requestId);
    if (request.method === "POST") return createClub(request, env, auth, requestId);
    return methodNotAllowed();
  }

  const club = path.match(/^\/api\/v1\/clubs\/([^/]+)$/u);
  if (club) {
    if (request.method === "GET") return getClub(env, auth, decodeURIComponent(club[1]), requestId);
    return methodNotAllowed();
  }
  const matches = path.match(/^\/api\/v1\/clubs\/([^/]+)\/matches$/u);
  if (matches) {
    const clubId = decodeURIComponent(matches[1]);
    if (request.method === "GET") return listMatches(request, env, auth, clubId, requestId);
    if (request.method === "POST") return createMatch(request, env, auth, clubId, requestId);
    return methodNotAllowed();
  }
  const match = path.match(/^\/api\/v1\/clubs\/([^/]+)\/matches\/([^/]+)$/u);
  if (match) {
    const clubId = decodeURIComponent(match[1]);
    const matchId = decodeURIComponent(match[2]);
    if (request.method === "GET") return getMatch(env, auth, clubId, matchId, requestId);
    if (request.method === "PUT") return updateMatch(request, env, auth, clubId, matchId, requestId);
    if (request.method === "DELETE") return deleteMatch(request, env, auth, clubId, matchId, requestId);
    return methodNotAllowed();
  }
  if (path === "/api/archive" || path === "/api/tenants") return readLegacy(request, env, auth, path, requestId);
  throw new HttpError(404, "NOT_FOUND", "The requested resource was not found.");
}

const PUBLIC_ASSETS = new Set(["/login.css", "/manifest.webmanifest", "/sw.js", "/registerSW.js", "/squora-favicon.png", "/squora-logo.png", "/pwa-192.png", "/pwa-512.png", "/pwa-maskable-512.png"]);

export default {
  async fetch(request, env): Promise<Response> {
    const startedAt = Date.now();
    const requestId = crypto.randomUUID();
    const url = new URL(request.url);
    const path = relativePath(url.pathname);
    let auth: AuthContext | null = null;
    let response: Response;
    try {
      if (path === "/auth/login" && request.method === "POST") response = await formLogin(request, env, requestId);
      else if (path === "/api/v1/auth/login" && request.method === "POST") response = await login(request, env, requestId);
      else if (request.method === "GET" && (PUBLIC_ASSETS.has(path) || path.startsWith("/workbox-"))) {
        response = withHeaders(await env.ASSETS.fetch(new Request(new URL(path, url.origin), request)), requestId);
      } else {
        try { auth = await requireAuth(request, env.DB); } catch (error) {
          if (!isApi(path) && request.method === "GET") {
            response = loginPage(requestId);
            recordRequest(startedAt, request, response, { requestId });
            return response;
          }
          throw error;
        }
        if (isApi(path)) response = await routeAuthenticated(request, env, auth, path, requestId);
        else {
          let asset = await env.ASSETS.fetch(new Request(new URL(path, url.origin), request));
          if (asset.status === 404 && request.method === "GET" && request.headers.get("Accept")?.includes("text/html")) asset = await env.ASSETS.fetch(new Request(new URL("/", url.origin), request));
          response = withHeaders(asset, requestId);
        }
      }
    } catch (error) {
      response = errorResponse(error, requestId);
    }
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) if (!response.headers.has(name)) response.headers.set(name, value);
    recordRequest(startedAt, request, response, { requestId, userId: auth?.userId });
    return response;
  },
} satisfies ExportedHandler<Env>;
