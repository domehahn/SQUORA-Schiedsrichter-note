import { env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CLUB_A, CLUB_B, ORIGIN, USER_A, migrate, resetDb, seedMembership, seedTwoTenants } from "./helpers";

describe("server-side tenant resolution and RBAC", () => {
  beforeAll(migrate);
  beforeEach(resetDb);

  it("shows only clubs backed by an active membership", async () => {
    const { cookieA } = await seedTwoTenants();
    const response = await SELF.fetch(`${ORIGIN}/api/v1/clubs`, { headers: { Cookie: cookieA } });
    expect(response.status).toBe(200);
    const body = await response.json<{ clubs: Array<{ id: string }> }>();
    expect(body.clubs.map((club) => club.id)).toEqual([CLUB_A]);
  });

  it("returns 404 for another tenant and reveals no club existence", async () => {
    const { cookieA } = await seedTwoTenants();
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}`, { headers: { Cookie: cookieA } })).status).toBe(200);
    const foreign = await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_B}`, { headers: { Cookie: cookieA } });
    expect(foreign.status).toBe(404);
    expect(await foreign.text()).not.toContain("Club B Test");
  });

  it("ends access immediately after membership removal", async () => {
    const { cookieA } = await seedTwoTenants();
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}`, { headers: { Cookie: cookieA } })).status).toBe(200);
    await env.DB.prepare("UPDATE memberships SET status='removed' WHERE club_id=? AND user_id=?").bind(CLUB_A, USER_A).run();
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}`, { headers: { Cookie: cookieA } })).status).toBe(404);
  });

  it("allows a viewer to read but never create matches", async () => {
    const { cookieA } = await seedTwoTenants();
    await env.DB.prepare("DELETE FROM memberships WHERE club_id=? AND user_id=?").bind(CLUB_A, USER_A).run();
    await seedMembership(CLUB_A, USER_A, "viewer");
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/matches`, { headers: { Cookie: cookieA } })).status).toBe(200);
    const denied = await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/matches`, { method: "POST", headers: { Cookie: cookieA, Origin: ORIGIN, "Content-Type": "application/json" }, body: "{}" });
    expect(denied.status).toBe(403);
  });
});

