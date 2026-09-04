import { env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CLUB_A, CLUB_B, TEAM_A, TEAM_B, USER_A, ORIGIN, jsonHeaders, migrate, resetDb, seedTwoTenants } from "./helpers";

const url = (club: string, team: string, suffix = "") => `${ORIGIN}/api/v1/clubs/${club}/teams/${team}/players${suffix}`;

describe("team roster (players) CRUD", () => {
  beforeAll(migrate);
  beforeEach(resetDb);

  it("creates, lists, updates and deletes a player with optimistic locking", async () => {
    const { cookieA } = await seedTwoTenants();
    const created = await SELF.fetch(url(CLUB_A, TEAM_A), { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify({ name: "Max Testspieler", shirtNumber: "7" }) });
    expect(created.status).toBe(201);
    const { player } = await created.json<{ player: { id: string; version: number } }>();

    const list = await (await SELF.fetch(url(CLUB_A, TEAM_A), { headers: { Cookie: cookieA } })).json<{ players: { name: string }[] }>();
    expect(list.players.map((p) => p.name)).toEqual(["Max Testspieler"]);

    const patched = await SELF.fetch(url(CLUB_A, TEAM_A, `/${player.id}`), { method: "PATCH", headers: jsonHeaders(cookieA), body: JSON.stringify({ version: player.version, name: "Max Testspieler", shirtNumber: "10" }) });
    expect(patched.status).toBe(200);
    expect((await patched.json<{ player: { version: number } }>()).player.version).toBe(2);

    // stale version -> 409
    expect((await SELF.fetch(url(CLUB_A, TEAM_A, `/${player.id}`), { method: "PATCH", headers: jsonHeaders(cookieA), body: JSON.stringify({ version: 1, name: "x" }) })).status).toBe(409);

    expect((await SELF.fetch(url(CLUB_A, TEAM_A, `/${player.id}`), { method: "DELETE", headers: jsonHeaders(cookieA), body: JSON.stringify({ version: 2 }) })).status).toBe(200);
    expect((await (await SELF.fetch(url(CLUB_A, TEAM_A), { headers: { Cookie: cookieA } })).json<{ players: unknown[] }>()).players).toHaveLength(0);
  });

  it("is team-scoped: no cross-club access, viewer cannot mutate", async () => {
    const { cookieA } = await seedTwoTenants();
    expect((await SELF.fetch(url(CLUB_B, TEAM_B), { headers: { Cookie: cookieA } })).status).toBe(404);
    expect((await SELF.fetch(url(CLUB_B, TEAM_B), { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify({ name: "X" }) })).status).toBe(404);
    await env.DB.prepare("UPDATE memberships SET role='viewer' WHERE club_id=? AND user_id=?").bind(CLUB_A, USER_A).run();
    expect((await SELF.fetch(url(CLUB_A, TEAM_A), { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify({ name: "X" }) })).status).toBe(403);
    expect((await SELF.fetch(url(CLUB_A, TEAM_A), { headers: { Cookie: cookieA } })).status).toBe(200);
  });

  it("stores first / last name separately and derives the combined name", async () => {
    const { cookieA } = await seedTwoTenants();
    const created = await SELF.fetch(url(CLUB_A, TEAM_A), { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify({ firstName: "Max", lastName: "Testspieler", shirtNumber: "7" }) });
    expect(created.status).toBe(201);
    const { player } = await created.json<{ player: { id: string; version: number; firstName: string; lastName: string; name: string } }>();
    expect(player).toMatchObject({ firstName: "Max", lastName: "Testspieler", name: "Max Testspieler" });

    const patched = await SELF.fetch(url(CLUB_A, TEAM_A, `/${player.id}`), { method: "PATCH", headers: jsonHeaders(cookieA), body: JSON.stringify({ version: player.version, firstName: "Max", lastName: "Beispiel" }) });
    expect((await patched.json<{ player: { name: string } }>()).player.name).toBe("Max Beispiel");

    const empty = await SELF.fetch(url(CLUB_A, TEAM_A, `/${player.id}`), { method: "PATCH", headers: jsonHeaders(cookieA), body: JSON.stringify({ version: 2, firstName: "", lastName: "" }) });
    expect(empty.status).toBe(422);
  });

  it("stores and updates pass number + birthdate, rejecting a malformed birthdate", async () => {
    const { cookieA } = await seedTwoTenants();
    const created = await SELF.fetch(url(CLUB_A, TEAM_A), { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify({ name: "Max Testspieler", shirtNumber: "7", passNumber: "0100-0001", birthdate: "01.01.2014" }) });
    expect(created.status).toBe(201);
    const { player } = await created.json<{ player: { id: string; version: number; passNumber: string; birthdate: string } }>();
    expect(player).toMatchObject({ passNumber: "0100-0001", birthdate: "01.01.2014" });

    const list = await (await SELF.fetch(url(CLUB_A, TEAM_A), { headers: { Cookie: cookieA } })).json<{ players: { passNumber: string | null; birthdate: string | null }[] }>();
    expect(list.players[0]).toMatchObject({ passNumber: "0100-0001", birthdate: "01.01.2014" });

    const bad = await SELF.fetch(url(CLUB_A, TEAM_A, `/${player.id}`), { method: "PATCH", headers: jsonHeaders(cookieA), body: JSON.stringify({ version: player.version, name: "Max Testspieler", birthdate: "2014" }) });
    expect(bad.status).toBe(422);

    const cleared = await SELF.fetch(url(CLUB_A, TEAM_A, `/${player.id}`), { method: "PATCH", headers: jsonHeaders(cookieA), body: JSON.stringify({ version: player.version, name: "Max Testspieler", passNumber: "", birthdate: "" }) });
    expect(cleared.status).toBe(200);
    expect((await cleared.json<{ player: { passNumber: string | null; birthdate: string | null } }>()).player).toMatchObject({ passNumber: null, birthdate: null });
  });

  it("rejects a duplicate externalId in the same team", async () => {
    const { cookieA } = await seedTwoTenants();
    const body = JSON.stringify({ name: "A", externalId: "SYN-1" });
    expect((await SELF.fetch(url(CLUB_A, TEAM_A), { method: "POST", headers: jsonHeaders(cookieA), body })).status).toBe(201);
    expect((await SELF.fetch(url(CLUB_A, TEAM_A), { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify({ name: "B", externalId: "SYN-1" }) })).status).toBe(409);
  });
});
