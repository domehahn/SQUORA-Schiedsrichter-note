import { env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CLUB_A, TEAM_A, USER_A, ORIGIN, jsonHeaders, matchBody, migrate, resetDb, seedTwoTenants } from "../helpers";

async function setRole(role: string): Promise<void> {
  await env.DB.prepare("UPDATE memberships SET role=? WHERE club_id=? AND user_id=?").bind(role, CLUB_A, USER_A).run();
}

describe("security · RBAC", () => {
  beforeAll(migrate);
  beforeEach(resetDb);

  it("a viewer can read but never mutate", async () => {
    const { cookieA } = await seedTwoTenants();
    await setRole("viewer");
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/matches`, { headers: { Cookie: cookieA } })).status).toBe(200);
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/matches`, { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify(matchBody()) })).status).toBe(403);
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/teams`, { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify({ name: "Z" }) })).status).toBe(403);
    const state = JSON.stringify({ version: 0, archive: [], deletedIds: [], tournaments: [], teams: [], current: null });
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/teams/${TEAM_A}/state`, { method: "PUT", headers: jsonHeaders(cookieA), body: state })).status).toBe(403);
  });

  it("a referee can record matches but not delete them, manage teams, import or delete the club", async () => {
    const { cookieA } = await seedTwoTenants();
    await setRole("referee");
    const created = await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/matches`, { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify(matchBody()) });
    expect(created.status).toBe(201);
    const id = (await created.json<{ match: { id: string } }>()).match.id;
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/matches/${id}`, { method: "DELETE", headers: jsonHeaders(cookieA), body: JSON.stringify({ version: 1 }) })).status).toBe(403);
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/teams`, { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify({ name: "Z" }) })).status).toBe(403);
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/teams/${TEAM_A}/dfbnet/imports`, { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify({ filename: "x.csv", players: [{ name: "X" }] }) })).status).toBe(403);
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/export`, { headers: { Cookie: cookieA } })).status).toBe(403);
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}`, { method: "DELETE", headers: jsonHeaders(cookieA), body: JSON.stringify({ confirm: "Club A Test" }) })).status).toBe(403);
  });

  it("only the club_owner may delete the club, not a club_admin", async () => {
    const { cookieA } = await seedTwoTenants();
    await setRole("club_admin");
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}`, { method: "DELETE", headers: jsonHeaders(cookieA), body: JSON.stringify({ confirm: "Club A Test" }) })).status).toBe(403);
    await setRole("club_owner");
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}`, { method: "DELETE", headers: jsonHeaders(cookieA), body: JSON.stringify({ confirm: "Club A Test" }) })).status).toBe(200);
  });
});
