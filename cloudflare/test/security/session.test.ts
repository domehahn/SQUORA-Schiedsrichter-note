import { env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { USER_A, ORIGIN, authCookie, jsonHeaders, migrate, resetDb, seedTwoTenants } from "../helpers";

const me = (cookie: string) => SELF.fetch(`${ORIGIN}/api/v1/me`, { headers: { Cookie: cookie } });

describe("security · sessions", () => {
  beforeAll(migrate);
  beforeEach(resetDb);

  it("rejects missing and malformed session cookies", async () => {
    await seedTwoTenants();
    expect((await SELF.fetch(`${ORIGIN}/api/v1/me`)).status).toBe(401);
    expect((await me("squora_session=not-a-real-token")).status).toBe(401);
    expect((await me(`squora_session=${"x".repeat(400)}`)).status).toBe(401);
  });

  it("rejects an expired session", async () => {
    const { cookieA } = await seedTwoTenants();
    await env.DB.prepare("UPDATE sessions SET expires_at=? WHERE user_id=?").bind(new Date(Date.now() - 1000).toISOString(), USER_A).run();
    expect((await me(cookieA)).status).toBe(401);
  });

  it("rejects a session for a disabled account", async () => {
    const { cookieA } = await seedTwoTenants();
    await env.DB.prepare("UPDATE users SET status='disabled' WHERE id=?").bind(USER_A).run();
    expect((await me(cookieA)).status).toBe(401);
  });

  it("revokes the current session on logout and every session on logout-all", async () => {
    const { cookieA } = await seedTwoTenants();
    const second = await authCookie(USER_A);
    expect((await SELF.fetch(`${ORIGIN}/api/v1/auth/logout`, { method: "POST", headers: jsonHeaders(cookieA) })).status).toBe(200);
    expect((await me(cookieA)).status).toBe(401);
    expect((await me(second)).status).toBe(200);

    const third = await authCookie(USER_A);
    expect((await SELF.fetch(`${ORIGIN}/api/v1/auth/logout-all`, { method: "POST", headers: jsonHeaders(second) })).status).toBe(200);
    expect((await me(second)).status).toBe(401);
    expect((await me(third)).status).toBe(401);
  });
});
