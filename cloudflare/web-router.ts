import {
  createSession,
  readCookie,
  SESSION_COOKIE_NAME,
  SESSION_LIFETIME_SECONDS,
  verifyPassword,
  verifySession,
} from "./auth";

const APP_PREFIX = "/schiedsrichter-note";
const LOGIN_PATH = "/auth/login";
const LOGOUT_PATH = "/auth/logout";
const SYNC_PATH = "/api/archive";
const MAX_SYNC_BYTES = 8_388_608;
const SESSION_COOKIE_PATH = `${APP_PREFIX}/`;

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

function rewriteRequest(request: Request, pathname: string): Request {
  const url = new URL(request.url);
  url.pathname = pathname;
  return new Request(url, request);
}

function withResponseHeaders(response: Response, noStore = false): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  if (noStore) {
    headers.set("Cache-Control", "no-store");
  } else if (headers.get("Content-Type")?.includes("text/html")) {
    headers.set("Cache-Control", "no-cache");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function redirect(location: string, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Location", location);
  return withResponseHeaders(new Response(null, { status: 303, headers: responseHeaders }), true);
}

function sessionCookie(token: string): string {
  return `${SESSION_COOKIE_NAME}=${token}; Path=${SESSION_COOKIE_PATH}; Max-Age=${SESSION_LIFETIME_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

function expiredSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=${SESSION_COOKIE_PATH}; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

function isSameOriginPost(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (origin) return origin === new URL(request.url).origin;
  const site = request.headers.get("Sec-Fetch-Site");
  return site === "same-origin" || site === "none";
}

function loginHtml(error?: string): string {
  const message = error ? `<div class="error" role="alert">${error}</div>` : "";
  return `<!doctype html>
<html lang="de">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#0b2559">
    <title>Anmelden · SQUORA Schiedsrichter Note</title>
    <style>
      :root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17233a;background:#eef4fb;color-scheme:light}
      *{box-sizing:border-box}body{margin:0;min-width:320px;min-height:100vh;min-height:100dvh;display:grid;place-items:center;padding:max(20px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(20px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));background:radial-gradient(circle at 8% 0,#d8e8ff 0,transparent 28rem),radial-gradient(circle at 100% 100%,#d9f5ef 0,transparent 25rem),#f4f7fb}
      main{width:min(100%,430px);padding:34px;border:1px solid #dbe4ef;border-radius:22px;background:rgba(255,255,255,.96);box-shadow:0 24px 70px rgba(17,48,89,.16)}
      .brand{display:flex;align-items:center;gap:13px;margin-bottom:28px}.mark{width:48px;height:48px;display:grid;place-items:center;border-radius:14px;color:white;background:linear-gradient(145deg,#173d88,#2471ce 55%,#0e988e);font-size:24px;font-weight:850}.brand span{display:flex;flex-direction:column}.brand strong{font-size:21px;letter-spacing:-.04em;color:#17498f}.brand small{margin-top:4px;color:#6d798b;font-size:11px;font-weight:700}
      .eyebrow{color:#2072c7;text-transform:uppercase;font-size:10px;font-weight:850;letter-spacing:.12em}h1{margin:5px 0 8px;font-size:28px;letter-spacing:-.045em}p{margin:0 0 24px;color:#68758a;font-size:13px;line-height:1.5}
      label{display:block;margin-top:15px;color:#48566b;font-size:12px;font-weight:750}input{width:100%;min-height:50px;margin-top:7px;border:1px solid #cfd9e6;border-radius:11px;padding:12px;background:white;color:#17233a;font:inherit;font-size:16px;outline:none}input:focus{border-color:#3b79c8;box-shadow:0 0 0 3px rgba(59,121,200,.12)}button{width:100%;min-height:50px;margin-top:22px;border:1px solid #175cad;border-radius:11px;background:#216cc3;color:white;font:inherit;font-weight:800;cursor:pointer;touch-action:manipulation;box-shadow:0 8px 20px rgba(24,84,158,.2)}
      .error{margin:0 0 18px;padding:11px 13px;border:1px solid #efc0c6;border-radius:10px;background:#fff1f3;color:#a52e3d;font-size:12px;font-weight:700}.privacy{margin:18px 0 0;text-align:center;font-size:10px;color:#8793a4}
      @media(max-width:480px){main{padding:26px 20px;border-radius:18px}h1{font-size:25px}}
    </style>
  </head>
  <body>
    <main>
      <div class="brand"><span class="mark">S</span><span><strong>SQUORA</strong><small>Schiedsrichter Note</small></span></div>
      <span class="eyebrow">Geschützter Bereich</span>
      <h1>Willkommen zurück</h1>
      <p>Melde dich an, um deine digitale Spielnotiz zu öffnen.</p>
      ${message}
      <form method="post" action="${APP_PREFIX}${LOGIN_PATH}">
        <label for="email">E-Mail-Adresse</label>
        <input id="email" name="email" type="email" autocomplete="username" required autofocus>
        <label for="password">Passwort</label>
        <input id="password" name="password" type="password" autocomplete="current-password" maxlength="200" required>
        <button type="submit">Anmelden</button>
      </form>
      <p class="privacy">Die Spieldaten bleiben weiterhin ausschließlich in diesem Browser gespeichert.</p>
    </main>
  </body>
</html>`;
}

function loginResponse(error?: string, status = 401): Response {
  return withResponseHeaders(new Response(loginHtml(error), { status, headers: { "Content-Type": "text/html; charset=utf-8" } }), true);
}

async function readLoginForm(request: Request): Promise<URLSearchParams | null> {
  const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
  if (!Number.isFinite(declaredLength) || declaredLength > 4096 || !request.body) return null;

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let body = "";
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > 4096) {
        await reader.cancel();
        return null;
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return new URLSearchParams(body);
  } catch {
    await reader.cancel().catch(() => undefined);
    return null;
  }
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  if (!isSameOriginPost(request)) return loginResponse("Die Anmeldung konnte nicht verarbeitet werden.", 403);
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.startsWith("application/x-www-form-urlencoded")) {
    return loginResponse("Die Anmeldung konnte nicht verarbeitet werden.", 400);
  }

  const form = await readLoginForm(request);
  if (!form) return loginResponse("Die Anmeldung konnte nicht verarbeitet werden.", 400);
  const email = (form.get("email") ?? "").trim().toLowerCase();
  const password = form.get("password") ?? "";
  const rateLimit = await env.LOGIN_RATE_LIMITER.limit({ key: email || "unknown" });
  if (!rateLimit.success) return loginResponse("Zu viele Anmeldeversuche. Bitte warte eine Minute.", 429);

  const valid = email === env.AUTH_EMAIL.toLowerCase() && await verifyPassword(password, env.AUTH_PASSWORD_HASH);
  if (!valid) return loginResponse("E-Mail-Adresse oder Passwort ist ungültig.");

  const token = await createSession(env.AUTH_EMAIL, env.SESSION_SECRET);
  return redirect(`${APP_PREFIX}/`, { "Set-Cookie": sessionCookie(token) });
}

function jsonResponse(body: unknown, status = 200): Response {
  return withResponseHeaders(
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } }),
    true,
  );
}

async function handleSync(request: Request, env: Env): Promise<Response> {
  const key = `note:${env.AUTH_EMAIL.toLowerCase()}`;

  if (request.method === "GET") {
    const stored = await env.DATA.get(key);
    return withResponseHeaders(
      new Response(stored ?? '{"updatedAt":null,"archive":[],"deletedIds":[],"tournaments":[],"teams":[],"current":null}', {
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }),
      true,
    );
  }

  if (request.method === "PUT") {
    if (!isSameOriginPost(request)) return jsonResponse({ error: "forbidden" }, 403);
    const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
    if (!Number.isFinite(declaredLength) || declaredLength > MAX_SYNC_BYTES) {
      return jsonResponse({ error: "payload too large" }, 413);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "invalid json" }, 400);
    }

    const source = body as { archive?: unknown; deletedIds?: unknown; tournaments?: unknown; teams?: unknown; current?: unknown };
    if (!source || typeof source !== "object" || !Array.isArray(source.archive)) {
      return jsonResponse({ error: "invalid shape" }, 422);
    }
    const deletedIds = Array.isArray(source.deletedIds)
      ? source.deletedIds.filter((id): id is string => typeof id === "string").slice(0, 5000)
      : [];
    const tournaments = Array.isArray(source.tournaments) ? source.tournaments : [];
    const teams = Array.isArray(source.teams) ? source.teams : [];
    const current = source.current && typeof source.current === "object" ? source.current : null;

    const updatedAt = new Date().toISOString();
    const record = JSON.stringify({ updatedAt, archive: source.archive, deletedIds, tournaments, teams, current });
    if (record.length > MAX_SYNC_BYTES) return jsonResponse({ error: "payload too large" }, 413);

    await env.DATA.put(key, record);
    return jsonResponse({ ok: true, updatedAt });
  }

  return jsonResponse({ error: "method not allowed" }, 405);
}

async function isAuthenticated(request: Request, env: Env): Promise<boolean> {
  const token = readCookie(request, SESSION_COOKIE_NAME);
  return token ? verifySession(token, env.AUTH_EMAIL, env.SESSION_SECRET) : false;
}

/** PWA plumbing that must load before the login gate: manifest, service worker, icons. Contains no user data. */
const PUBLIC_ASSETS = new Set([
  "/manifest.webmanifest",
  "/sw.js",
  "/registerSW.js",
  "/squora-favicon.png",
  "/squora-logo.png",
  "/pwa-192.png",
  "/pwa-512.png",
  "/pwa-maskable-512.png",
]);

function isPublicAsset(path: string): boolean {
  return PUBLIC_ASSETS.has(path) || path.startsWith("/workbox-");
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === APP_PREFIX) {
      url.pathname = `${APP_PREFIX}/`;
      return Response.redirect(url.toString(), 308);
    }

    const hasPrefix = url.pathname.startsWith(`${APP_PREFIX}/`);
    const relativePath = hasPrefix ? url.pathname.slice(APP_PREFIX.length) || "/" : url.pathname;

    if (relativePath === LOGIN_PATH && request.method === "POST") return handleLogin(request, env);
    if (relativePath === LOGOUT_PATH && request.method === "POST") {
      if (!isSameOriginPost(request)) return new Response("Forbidden", { status: 403 });
      return redirect(`${APP_PREFIX}/`, { "Set-Cookie": expiredSessionCookie() });
    }

    if (request.method === "GET" && isPublicAsset(relativePath)) {
      return withResponseHeaders(await env.ASSETS.fetch(rewriteRequest(request, relativePath)));
    }

    if (!await isAuthenticated(request, env)) {
      if (relativePath === SYNC_PATH) return jsonResponse({ error: "unauthorized" }, 401);
      return loginResponse();
    }
    if (relativePath === SYNC_PATH) return handleSync(request, env);
    if (relativePath === LOGIN_PATH || relativePath === LOGOUT_PATH) return redirect(`${APP_PREFIX}/`);

    let response = await env.ASSETS.fetch(rewriteRequest(request, relativePath));

    if (
      response.status === 404 &&
      request.method === "GET" &&
      (request.headers.get("Accept")?.includes("text/html") ?? false)
    ) {
      response = await env.ASSETS.fetch(rewriteRequest(request, "/"));
    }

    return withResponseHeaders(response);
  },
} satisfies ExportedHandler<Env>;
