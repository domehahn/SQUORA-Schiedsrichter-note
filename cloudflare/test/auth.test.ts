import { env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sha256 } from "../auth/session";
import { ORIGIN, USER_A, USER_B, migrate, resetDb, seedUser } from "./helpers";

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

describe("password reset", () => {
  beforeAll(migrate);
  beforeEach(resetDb);

  const forgot = (email: string) => SELF.fetch(`${ORIGIN}/api/v1/auth/forgot-password`, {
    method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify({ email }),
  });

  it("gives the same generic response whether or not the address is registered (no account enumeration)", async () => {
    await seedUser(USER_A, "user-a@example.invalid");
    const known = await forgot("user-a@example.invalid");
    const unknown = await forgot("nobody@example.invalid");
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(await known.text()).toBe(await unknown.text());
  });

  it("mints a token only for a real, active account", async () => {
    await seedUser(USER_A, "user-a@example.invalid");
    await seedUser(USER_B, "user-b@example.invalid", "disabled");
    await forgot("user-a@example.invalid");
    await forgot("user-b@example.invalid");
    await forgot("nobody@example.invalid");
    const rows = await env.DB.prepare("SELECT user_id AS userId FROM password_reset_tokens").all<{ userId: string }>();
    expect(rows.results.map((r) => r.userId)).toEqual([USER_A]);
  });

  async function issueToken(userId: string, options: { expired?: boolean; used?: boolean } = {}): Promise<string> {
    const token = `AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA${crypto.randomUUID().replaceAll("-", "")}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (options.expired ? -1000 : 30 * 60_000)).toISOString();
    await env.DB.prepare("INSERT INTO password_reset_tokens (id,user_id,token_hash,expires_at,used_at,created_at) VALUES (?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), userId, await sha256(token), expiresAt, options.used ? now.toISOString() : null, now.toISOString()).run();
    return token;
  }

  it("resets the password with a valid token, then revokes every existing session", async () => {
    await seedUser(USER_A, "user-a@example.invalid");
    const login = await SELF.fetch(`${ORIGIN}/api/v1/auth/login`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify({ email: "user-a@example.invalid", password: "test-password" }) });
    const oldCookie = login.headers.get("Set-Cookie")!;
    const token = await issueToken(USER_A);

    const reset = await SELF.fetch(`${ORIGIN}/api/v1/auth/reset-password`, {
      method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify({ token, password: "new-password-123" }),
    });
    expect(reset.status).toBe(200);

    expect((await SELF.fetch(`${ORIGIN}/api/v1/me`, { headers: { Cookie: oldCookie } })).status).toBe(401);
    const relogin = await SELF.fetch(`${ORIGIN}/api/v1/auth/login`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify({ email: "user-a@example.invalid", password: "new-password-123" }) });
    expect(relogin.status).toBe(200);
    const oldPasswordLogin = await SELF.fetch(`${ORIGIN}/api/v1/auth/login`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify({ email: "user-a@example.invalid", password: "test-password" }) });
    expect(oldPasswordLogin.status).toBe(401);
  });

  it("is single-use — a second attempt with the same token fails", async () => {
    await seedUser(USER_A, "user-a@example.invalid");
    const token = await issueToken(USER_A);
    const first = await SELF.fetch(`${ORIGIN}/api/v1/auth/reset-password`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify({ token, password: "first-new-password" }) });
    expect(first.status).toBe(200);
    const second = await SELF.fetch(`${ORIGIN}/api/v1/auth/reset-password`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify({ token, password: "second-new-password" }) });
    expect(second.status).toBe(400);
  });

  it("rejects an expired token, an already-used token, and a token for a disabled account", async () => {
    await seedUser(USER_A, "user-a@example.invalid");
    await seedUser(USER_B, "user-b@example.invalid", "disabled");
    const expired = await issueToken(USER_A, { expired: true });
    const used = await issueToken(USER_A, { used: true });
    const forDisabled = await issueToken(USER_B);
    for (const token of [expired, used, forDisabled]) {
      const res = await SELF.fetch(`${ORIGIN}/api/v1/auth/reset-password`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify({ token, password: "irrelevant-password" }) });
      expect(res.status).toBe(400);
    }
  });

  it("rejects a password under 12 characters", async () => {
    await seedUser(USER_A, "user-a@example.invalid");
    const token = await issueToken(USER_A);
    const res = await SELF.fetch(`${ORIGIN}/api/v1/auth/reset-password`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify({ token, password: "short" }) });
    expect(res.status).toBe(422);
  });

  it("serves the server-rendered forgot-password and reset-password pages", async () => {
    const forgotPage = await SELF.fetch(`${ORIGIN}/auth/forgot-password`);
    expect(forgotPage.status).toBe(200);
    expect(await forgotPage.text()).toContain("Passwort vergessen");

    const resetPage = await SELF.fetch(`${ORIGIN}/auth/reset-password?token=anything`);
    expect(resetPage.status).toBe(200);
    expect(await resetPage.text()).toContain("Neues Passwort");
  });
});

