import { env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CLUB_A, CLUB_B, TEAM_A, TEAM_A2, USER_A, ORIGIN, authCookie, jsonHeaders, migrate, resetDb, seedTwoTenants } from "./helpers";

describe("team (Jugend) scoping", () => {
  beforeAll(migrate);
  beforeEach(resetDb);

  it("lists a club's teams and creates new ones", async () => {
    const { cookieA } = await seedTwoTenants();
    const list = await (await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/teams`, { headers: { Cookie: cookieA } })).json<{ teams: { id: string }[] }>();
    expect(list.teams.map((team) => team.id).sort()).toEqual([TEAM_A, TEAM_A2].sort());

    const created = await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/teams`, { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify({ name: "A · E1", ageGroup: "E" }) });
    expect(created.status).toBe(201);
    const after = await (await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/teams`, { headers: { Cookie: cookieA } })).json<{ teams: unknown[] }>();
    expect(after.teams).toHaveLength(3);
  });

  it("never exposes a foreign club's teams", async () => {
    const { cookieA } = await seedTwoTenants();
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_B}/teams`, { headers: { Cookie: cookieA } })).status).toBe(404);
  });

  it("rejects a team-create body with an unexpected field", async () => {
    const { cookieA } = await seedTwoTenants();
    const res = await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/teams`, {
      method: "POST", headers: jsonHeaders(cookieA),
      body: JSON.stringify({ name: "D3", ageGroup: "D", role: "club_owner" }),
    });
    expect(res.status).toBe(422);
    expect((await res.json<{ error: { code: string } }>()).error.code).toBe("UNKNOWN_FIELD");
  });

  it("restricts a team-scoped membership to its own team", async () => {
    await seedTwoTenants();
    // downgrade user A to a membership scoped to team D1 only
    await env.DB.prepare("UPDATE memberships SET team_id=?, role='referee' WHERE club_id=? AND user_id=?").bind(TEAM_A, CLUB_A, USER_A).run();
    const cookie = await authCookie(USER_A);
    const list = await (await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/teams`, { headers: { Cookie: cookie } })).json<{ teams: { id: string }[] }>();
    expect(list.teams.map((team) => team.id)).toEqual([TEAM_A]);
    const payload = JSON.stringify({ version: 0, archive: [], deletedIds: [], tournaments: [], teams: [], current: null });
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/teams/${TEAM_A}/state`, { method: "PUT", headers: jsonHeaders(cookie), body: payload })).status).toBe(200);
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/teams/${TEAM_A2}/state`, { method: "PUT", headers: jsonHeaders(cookie), body: payload })).status).toBe(404);
  });
});
