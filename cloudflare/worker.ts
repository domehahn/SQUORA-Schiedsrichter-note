import { listClubs, createClub, getClub, deleteClub, cancelClubDeletion } from "./api/clubs";
import { deleteAccount } from "./api/account";
import { exportClub } from "./api/export";
import { login, logout, me, register } from "./api/auth";
import { acceptInvitation, createInvitation, listInvitations, revokeInvitation, viewInvitation } from "./api/invitations";
import { disableLiveShare, enableLiveShare, getPublicLive } from "./api/live";
import { createMatch, deleteMatch, getMatch, listMatches, updateMatch } from "./api/matches";
import { listMembers, removeMember, updateMember } from "./api/members";
import { listLegacyTenants, migrateLegacy, readLegacyPayload } from "./api/legacy-migration";
import { getState, putState } from "./api/state";
import { createTeam, listTeams } from "./api/teams";
import { confirmDfbnetImport, createDfbnetImport, listDfbnetImports } from "./api/dfbnet";
import { clearPlayers, createPlayer, deletePlayer, listPlayers, updatePlayer } from "./api/players";
import { requireAuth, type AuthContext } from "./auth/session";
import { errorResponse, HttpError, recordRequest, SECURITY_HEADERS, withHeaders } from "./core/http";
import { readLegacy } from "./legacy/kv-migration";
import { checkAndAlert } from "./services/alerting";
import { runRetention } from "./services/retention";

/**
 * The application is mounted at squora.de/schiedsrichter-note/. Every incoming
 * path is normalised by stripping this prefix, and every outgoing URL the Worker
 * emits (login page assets, form actions, redirects) is prefixed with it.
 */
const MOUNT_PATH = "/schiedsrichter-note";

function relativePath(pathname: string): string {
  return pathname === MOUNT_PATH ? "/" : pathname.startsWith(`${MOUNT_PATH}/`) ? pathname.slice(MOUNT_PATH.length) : pathname;
}

function loginHtml(error = ""): string {
  const message = error ? `<div class="error" role="alert">${error}</div>` : "";
  return `<!doctype html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0b2559"><title>Anmelden · SQUORA Schiedsrichter Note</title><link rel="stylesheet" href="${MOUNT_PATH}/login.css"></head><body><main><div class="brand"><strong>SQUORA</strong><small>Schiedsrichter Note</small></div><span class="eyebrow">Geschützter Bereich</span><h1>Willkommen zurück</h1><p>Melde dich an, um deine digitale Spielnotiz zu öffnen.</p>${message}<form method="post" action="${MOUNT_PATH}/auth/login"><label for="email">E-Mail-Adresse</label><input id="email" name="email" type="email" autocomplete="username" maxlength="254" required autofocus><label for="password">Passwort</label><input id="password" name="password" type="password" autocomplete="current-password" maxlength="1024" required><button type="submit">Anmelden</button></form></main></body></html>`;
}

function loginPage(requestId: string, error = "", status = 200): Response {
  return withHeaders(new Response(loginHtml(error), { status, headers: { "Content-Type": "text/html; charset=utf-8" } }), requestId, true);
}

/**
 * Public, unauthenticated live-ticker page. Static shell only — `live.js`
 * (same-origin, CSP allows no inline scripts) polls the public JSON endpoint
 * and renders score + a generic event log. No player names, no login.
 */
function livePage(requestId: string): Response {
  const html = `<!doctype html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0b2559"><title>Liveticker · SQUORA Schiedsrichter Note</title><link rel="stylesheet" href="${MOUNT_PATH}/live.css"></head><body><main><span class="eyebrow">Liveticker</span><h1><span id="home-name">–</span><span>–</span><span id="away-name">–</span></h1><div class="score" id="score">– : –</div><div class="phase" id="phase">–</div><div class="error" id="error" role="alert" hidden>Dieser Liveticker ist nicht (mehr) verfügbar.</div><ul id="events"></ul><p class="updated" id="updated"></p></main><script src="${MOUNT_PATH}/live.js" defer></script></body></html>`;
  return withHeaders(new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }), requestId, true);
}

function redirect(location: string, requestId: string, cookie?: string): Response {
  const headers = new Headers({ Location: location });
  if (cookie) headers.set("Set-Cookie", cookie);
  return withHeaders(new Response(null, { status: 303, headers }), requestId, true);
}

async function formLogin(request: Request, env: Env, requestId: string): Promise<Response> {
  try {
    const response = await login(request, env, requestId);
    return redirect(`${MOUNT_PATH}/`, requestId, response.headers.get("Set-Cookie") ?? undefined);
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
  if (path === "/api/v1/me" && request.method === "DELETE") return deleteAccount(request, env, auth, requestId);
  if (path === "/api/v1/auth/logout" && request.method === "POST") return logout(request, env, requestId);
  if (path === "/api/v1/auth/logout-all" && request.method === "POST") return logout(request, env, requestId, true);
  if (path === "/api/v1/legacy/tenants" && request.method === "GET") return listLegacyTenants(env, auth, requestId);
  const legacyPayload = path.match(/^\/api\/v1\/legacy\/tenants\/([^/]+)\/payload$/u);
  if (legacyPayload) {
    if (request.method === "GET") return readLegacyPayload(env, auth, decodeURIComponent(legacyPayload[1]), requestId);
    return methodNotAllowed();
  }
  if (path === "/auth/logout" && request.method === "POST") {
    const response = await logout(request, env, requestId);
    return redirect(`${MOUNT_PATH}/`, requestId, response.headers.get("Set-Cookie") ?? undefined);
  }
  if (path === "/api/v1/clubs") {
    if (request.method === "GET") return listClubs(env, auth, requestId);
    if (request.method === "POST") return createClub(request, env, auth, requestId);
    return methodNotAllowed();
  }

  const club = path.match(/^\/api\/v1\/clubs\/([^/]+)$/u);
  if (club) {
    if (request.method === "GET") return getClub(env, auth, decodeURIComponent(club[1]), requestId);
    if (request.method === "DELETE") return deleteClub(request, env, auth, decodeURIComponent(club[1]), requestId);
    return methodNotAllowed();
  }
  const clubExport = path.match(/^\/api\/v1\/clubs\/([^/]+)\/export$/u);
  if (clubExport) {
    if (request.method === "GET") return exportClub(request, env, auth, decodeURIComponent(clubExport[1]), requestId);
    return methodNotAllowed();
  }
  const clubCancelDeletion = path.match(/^\/api\/v1\/clubs\/([^/]+)\/deletion\/cancel$/u);
  if (clubCancelDeletion) {
    if (request.method === "POST") return cancelClubDeletion(request, env, auth, decodeURIComponent(clubCancelDeletion[1]), requestId);
    return methodNotAllowed();
  }
  if (path === "/api/v1/invitations/accept" && request.method === "POST") return acceptInvitation(request, env, auth, requestId);
  const members = path.match(/^\/api\/v1\/clubs\/([^/]+)\/members$/u);
  if (members) {
    const clubId = decodeURIComponent(members[1]);
    if (request.method === "GET") return listMembers(request, env, auth, clubId, requestId);
    if (request.method === "POST") return createInvitation(request, env, auth, clubId, requestId);
    return methodNotAllowed();
  }
  const invitations = path.match(/^\/api\/v1\/clubs\/([^/]+)\/invitations$/u);
  if (invitations) {
    const clubId = decodeURIComponent(invitations[1]);
    if (request.method === "GET") return listInvitations(request, env, auth, clubId, requestId);
    if (request.method === "POST") return createInvitation(request, env, auth, clubId, requestId);
    return methodNotAllowed();
  }
  const invitation = path.match(/^\/api\/v1\/clubs\/([^/]+)\/invitations\/([^/]+)$/u);
  if (invitation) {
    if (request.method === "DELETE") return revokeInvitation(request, env, auth, decodeURIComponent(invitation[1]), decodeURIComponent(invitation[2]), requestId);
    return methodNotAllowed();
  }
  const member = path.match(/^\/api\/v1\/clubs\/([^/]+)\/members\/([^/]+)$/u);
  if (member) {
    const clubId = decodeURIComponent(member[1]);
    const userId = decodeURIComponent(member[2]);
    if (request.method === "PATCH") return updateMember(request, env, auth, clubId, userId, requestId);
    if (request.method === "DELETE") return removeMember(request, env, auth, clubId, userId, requestId);
    return methodNotAllowed();
  }
  const teams = path.match(/^\/api\/v1\/clubs\/([^/]+)\/teams$/u);
  if (teams) {
    const clubId = decodeURIComponent(teams[1]);
    if (request.method === "GET") return listTeams(env, auth, clubId, requestId);
    if (request.method === "POST") return createTeam(request, env, auth, clubId, requestId);
    return methodNotAllowed();
  }
  const teamState = path.match(/^\/api\/v1\/clubs\/([^/]+)\/teams\/([^/]+)\/state$/u);
  if (teamState) {
    const clubId = decodeURIComponent(teamState[1]);
    const teamId = decodeURIComponent(teamState[2]);
    if (request.method === "GET") return getState(env, auth, clubId, teamId, requestId);
    if (request.method === "PUT") return putState(request, env, auth, clubId, teamId, requestId);
    return methodNotAllowed();
  }
  const liveShare = path.match(/^\/api\/v1\/clubs\/([^/]+)\/teams\/([^/]+)\/draft\/share$/u);
  if (liveShare) {
    const clubId = decodeURIComponent(liveShare[1]);
    const teamId = decodeURIComponent(liveShare[2]);
    if (request.method === "POST") return enableLiveShare(request, env, auth, clubId, teamId, requestId);
    if (request.method === "DELETE") return disableLiveShare(request, env, auth, clubId, teamId, requestId);
    return methodNotAllowed();
  }
  const legacyMigration = path.match(/^\/api\/v1\/clubs\/([^/]+)\/teams\/([^/]+)\/migrations\/legacy$/u);
  if (legacyMigration) {
    if (request.method === "POST") return migrateLegacy(request, env, auth, decodeURIComponent(legacyMigration[1]), decodeURIComponent(legacyMigration[2]), requestId);
    return methodNotAllowed();
  }
  const imports = path.match(/^\/api\/v1\/clubs\/([^/]+)\/teams\/([^/]+)\/dfbnet\/imports$/u);
  if (imports) {
    const clubId = decodeURIComponent(imports[1]);
    const teamId = decodeURIComponent(imports[2]);
    if (request.method === "GET") return listDfbnetImports(request, env, auth, clubId, teamId, requestId);
    if (request.method === "POST") return createDfbnetImport(request, env, auth, clubId, teamId, requestId);
    return methodNotAllowed();
  }
  const importConfirm = path.match(/^\/api\/v1\/clubs\/([^/]+)\/teams\/([^/]+)\/dfbnet\/imports\/([^/]+)\/confirm$/u);
  if (importConfirm) {
    const clubId = decodeURIComponent(importConfirm[1]);
    const teamId = decodeURIComponent(importConfirm[2]);
    const importId = decodeURIComponent(importConfirm[3]);
    if (request.method === "POST") return confirmDfbnetImport(request, env, auth, clubId, teamId, importId, requestId);
    return methodNotAllowed();
  }
  const players = path.match(/^\/api\/v1\/clubs\/([^/]+)\/teams\/([^/]+)\/players$/u);
  if (players) {
    const clubId = decodeURIComponent(players[1]);
    const teamId = decodeURIComponent(players[2]);
    if (request.method === "GET") return listPlayers(env, auth, clubId, teamId, requestId);
    if (request.method === "POST") return createPlayer(request, env, auth, clubId, teamId, requestId);
    if (request.method === "DELETE") return clearPlayers(request, env, auth, clubId, teamId, requestId);
    return methodNotAllowed();
  }
  const player = path.match(/^\/api\/v1\/clubs\/([^/]+)\/teams\/([^/]+)\/players\/([^/]+)$/u);
  if (player) {
    const clubId = decodeURIComponent(player[1]);
    const teamId = decodeURIComponent(player[2]);
    const playerId = decodeURIComponent(player[3]);
    if (request.method === "PATCH") return updatePlayer(request, env, auth, clubId, teamId, playerId, requestId);
    if (request.method === "DELETE") return deletePlayer(request, env, auth, clubId, teamId, playerId, requestId);
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

const PUBLIC_ASSETS = new Set(["/login.css", "/live.css", "/live.js", "/manifest.webmanifest", "/sw.js", "/registerSW.js", "/squora-favicon.png", "/squora-logo.png", "/pwa-192.png", "/pwa-512.png", "/pwa-maskable-512.png"]);

export default {
  async fetch(request, env): Promise<Response> {
    const startedAt = Date.now();
    const requestId = crypto.randomUUID();
    const url = new URL(request.url);
    const path = relativePath(url.pathname);
    let auth: AuthContext | null = null;
    let response: Response;
    try {
      const publicInvite = path.match(/^\/api\/v1\/invitations\/([^/]+)$/u);
      const publicLiveApi = path.match(/^\/api\/v1\/live\/([^/]+)$/u);
      const publicLivePage = path.match(/^\/live\/([^/]+)$/u);
      if (path === "/auth/login" && request.method === "POST") response = await formLogin(request, env, requestId);
      else if (path === "/api/v1/auth/login" && request.method === "POST") response = await login(request, env, requestId);
      else if (path === "/api/v1/auth/register" && request.method === "POST") response = await register(request, env, requestId);
      else if (publicInvite && request.method === "GET") response = await viewInvitation(request, env, decodeURIComponent(publicInvite[1]), requestId);
      else if (publicLiveApi && request.method === "GET") response = await getPublicLive(request, env, decodeURIComponent(publicLiveApi[1]), requestId);
      else if (publicLivePage && request.method === "GET") response = livePage(requestId);
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

  async scheduled(_event, env, ctx): Promise<void> {
    const requestId = crypto.randomUUID();
    ctx.waitUntil((async () => {
      try {
        const retention = await runRetention(env.DB);
        console.log(JSON.stringify({ requestId, level: "info", code: "RETENTION_RUN", ...retention }));
        const alerts = await checkAndAlert(env);
        if (alerts.length) console.log(JSON.stringify({ requestId, level: "warn", code: "ALERT_SENT", alerts }));
      } catch {
        console.error(JSON.stringify({ requestId, level: "error", code: "SCHEDULED_FAILED" }));
      }
    })());
  },
} satisfies ExportedHandler<Env>;
