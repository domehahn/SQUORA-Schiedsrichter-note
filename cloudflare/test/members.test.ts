import { env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CLUB_A, CLUB_B, ORIGIN, USER_A, USER_B, jsonHeaders, migrate, resetDb, seedMembership, seedTwoTenants } from "./helpers";

describe("membership lifecycle", () => {
  beforeAll(migrate);
  beforeEach(resetDb);

  it("lets an owner change a member's role and remove them with an audit trail", async () => {
    const { cookieA } = await seedTwoTenants();
    await seedMembership(CLUB_A, USER_B, "viewer");
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/members/${USER_B}`, {
      method: "PATCH", headers: jsonHeaders(cookieA), body: JSON.stringify({ role: "referee", status: "active" }),
    })).status).toBe(200);
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/members/${USER_B}`, {
      method: "DELETE", headers: { Cookie: cookieA, Origin: ORIGIN },
    })).status).toBe(200);
    const actions = (await env.DB.prepare("SELECT action FROM audit_log WHERE club_id=? ORDER BY created_at").bind(CLUB_A).all<{ action: string }>()).results.map((row) => row.action);
    expect(actions).toContain("MEMBER_ROLE_CHANGED");
    expect(actions).toContain("MEMBER_REMOVED");
  });

  it("returns 404 for a foreign club and denies a viewer from inviting", async () => {
    const { cookieA } = await seedTwoTenants();
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_B}/members`, { headers: { Cookie: cookieA } })).status).toBe(404);
    await env.DB.prepare("UPDATE memberships SET role='viewer' WHERE club_id=? AND user_id=?").bind(CLUB_A, USER_A).run();
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/invitations`, {
      method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify({ email: "x@example.invalid", role: "viewer" }),
    })).status).toBe(403);
  });

  it("revokes access on removal in the next request", async () => {
    const { cookieA, cookieB } = await seedTwoTenants();
    await seedMembership(CLUB_A, USER_B, "viewer");
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}`, { headers: { Cookie: cookieB } })).status).toBe(200);
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/members/${USER_B}`, { method: "DELETE", headers: { Cookie: cookieA, Origin: ORIGIN } })).status).toBe(200);
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}`, { headers: { Cookie: cookieB } })).status).toBe(404);
  });

  it("never allows removal of the last active owner", async () => {
    const { cookieA } = await seedTwoTenants();
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/members/${USER_A}`, { method: "DELETE", headers: { Cookie: cookieA, Origin: ORIGIN } })).status).toBe(409);
  });
});
