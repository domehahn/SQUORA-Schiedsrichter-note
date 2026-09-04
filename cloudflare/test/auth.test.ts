import { env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sha256 } from "../auth/session";
import { ORIGIN, USER_A, migrate, resetDb, seedUser } from "./helpers";

describe("D1 authentication and revocable sessions", () => {
  beforeAll(migrate);
  beforeEach(resetDb);

  it("stores only a hash of a random session token and revokes it on logout", async () => {
    await seedUser(USER_A, "user-a@example.invalid");
    const login = await SELF.fetch(`${ORIGIN}/api/v1/auth/login`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify({ email: "user-a@example.invalid", password: "test-password" }) });
    expect(login.status).toBe(200);
    const setCookie = login.headers.get("Set-Cookie")!;
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Strict");
    const token = setCookie.match(/squora_session=([^;]+)/)![1];
    const stored = await env.DB.prepare("SELECT id_hash AS idHash FROM sessions").first<{ idHash: string }>();
    expect(stored?.idHash).toBe(await sha256(token));
    expect(stored?.idHash).not.toContain(token);
    const cookie = `squora_session=${token}`;
    expect((await SELF.fetch(`${ORIGIN}/api/v1/me`, { headers: { Cookie: cookie } })).status).toBe(200);
    expect((await SELF.fetch(`${ORIGIN}/api/v1/auth/logout`, { method: "POST", headers: { Cookie: cookie, Origin: ORIGIN } })).status).toBe(200);
    expect((await SELF.fetch(`${ORIGIN}/api/v1/me`, { headers: { Cookie: cookie } })).status).toBe(401);
  });

  it("shows the login page for an unauthenticated navigation to a still-gated route, but never swaps a script/style sub-resource request for login HTML", async () => {
    // "/" is the SPA shell itself — the one non-API GET route still gated by
    // requireAuth. A real browser navigation sends Accept: text/html.
    const nav = await SELF.fetch(`${ORIGIN}/`, { headers: { Accept: "text/html,application/xhtml+xml" } });
    expect(nav.status).toBe(200);
    expect(nav.headers.get("Content-Type")).toContain("text/html");
    expect(await nav.text()).toContain("Anmelden");

    // A <script>/<link> sub-resource request never sends Accept: text/html —
    // if the session is invalid when this fires (e.g. it expired while the
    // SPA shell was already loaded), the response must not be HTML: the
    // browser rejects a text/html payload for a .js/.css request with a MIME
    // error, which is a worse failure mode than a clean error status.
    for (const accept of ["*/*", "text/css,*/*;q=0.1", undefined]) {
      const headers: Record<string, string> = {};
      if (accept) headers.Accept = accept;
      const asset = await SELF.fetch(`${ORIGIN}/`, { headers });
      expect(asset.status).not.toBe(200);
      expect(asset.headers.get("Content-Type")).not.toContain("text/html");
    }
  });

  it("serves the compiled JS/CSS app-shell bundle without a session, so the service worker can precache it regardless of auth state", async () => {
    // These carry no secrets — just static, content-hashed client code — and
    // must never require auth: a service worker precaches them at install
    // time regardless of whether the browser happens to be authenticated at
    // that moment. Gating them previously meant an unauthenticated precache
    // fetch got the login page's HTML back and permanently cached THAT under
    // the .js/.css URL (precache entries are only re-fetched when the file's
    // content hash changes, so this persisted across deploys).
    const asset = await SELF.fetch(`${ORIGIN}/assets/index-anything.js`, { headers: { Accept: "*/*" } });
    expect(asset.headers.get("Content-Type") ?? "").not.toContain("text/html");
    expect(await asset.text()).not.toContain("Anmelden");
    const themeInit = await SELF.fetch(`${ORIGIN}/theme-init.js`, { headers: { Accept: "*/*" } });
    expect(themeInit.headers.get("Content-Type") ?? "").not.toContain("text/html");
    expect(await themeInit.text()).not.toContain("Anmelden");
  });

  it("rejects invalid credentials generically and rejects cross-origin login", async () => {
    await seedUser(USER_A, "user-a@example.invalid");
    const invalid = await SELF.fetch(`${ORIGIN}/api/v1/auth/login`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify({ email: "user-a@example.invalid", password: "wrong" }) });
    expect(invalid.status).toBe(401);
    expect(await invalid.text()).not.toContain("user-a@example.invalid");
    const csrf = await SELF.fetch(`${ORIGIN}/api/v1/auth/login`, { method: "POST", headers: { Origin: "https://evil.invalid", "Content-Type": "application/json" }, body: "{}" });
    expect(csrf.status).toBe(403);
  });

  it("invalidates an existing session immediately when the user is disabled", async () => {
    await seedUser(USER_A, "user-a@example.invalid");
    const login = await SELF.fetch(`${ORIGIN}/api/v1/auth/login`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify({ email: "user-a@example.invalid", password: "test-password" }) });
    const cookie = login.headers.get("Set-Cookie")!;
    await env.DB.prepare("UPDATE users SET status='disabled' WHERE id=?").bind(USER_A).run();
    expect((await SELF.fetch(`${ORIGIN}/api/v1/me`, { headers: { Cookie: cookie } })).status).toBe(401);
  });
});

