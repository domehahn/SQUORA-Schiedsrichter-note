import { env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CLUB_A, CLUB_B, TEAM_A, TEAM_A2, TEAM_B, USER_A, ORIGIN, jsonHeaders, migrate, resetDb, seedTwoTenants } from "./helpers";

const roster = (extra: Record<string, unknown>[] = []) => ({
  filename: "synthetic-roster.csv",
  players: [
    { name: "Testspieler A", firstName: "Max", shirtNumber: "7", externalId: "SYN-1", birthdate: "01.01.2014", pass: "0100-0001" },
    { name: "Testspieler B", firstName: "Anna", shirtNumber: "9", externalId: "SYN-2" },
    ...extra,
  ],
});

const url = (club: string, team: string, suffix = "") => `${ORIGIN}/api/v1/clubs/${club}/teams/${team}/dfbnet/imports${suffix}`;

describe("DFBnet staged import", () => {
  beforeAll(migrate);
  beforeEach(resetDb);

  it("previews then confirms, writing players and audit rows", async () => {
    const { cookieA } = await seedTwoTenants();
    const preview = await SELF.fetch(url(CLUB_A, TEAM_A), { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify(roster()) });
    expect(preview.status).toBe(201);
    const { importId, status } = await preview.json<{ importId: string; status: string }>();
    expect(status).toBe("previewed");
    expect((await env.DB.prepare("SELECT count(*) AS n FROM players WHERE club_id=?").bind(CLUB_A).first<{ n: number }>())?.n).toBe(0);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM audit_log WHERE action='DFBNET_IMPORT_STARTED'").first<{ n: number }>())?.n).toBe(1);

    const confirm = await SELF.fetch(url(CLUB_A, TEAM_A, `/${importId}/confirm`), { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify(roster()) });
    expect(confirm.status).toBe(200);
    const players = await env.DB.prepare("SELECT name,shirt_number AS shirt FROM players WHERE club_id=? AND team_id=? ORDER BY name").bind(CLUB_A, TEAM_A).all<{ name: string; shirt: string }>();
    expect(players.results.map((p) => p.name)).toEqual(["Testspieler A", "Testspieler B"]);
    const row = await env.DB.prepare("SELECT status FROM dfbnet_imports WHERE club_id=? AND id=?").bind(CLUB_A, importId).first<{ status: string }>();
    expect(row?.status).toBe("completed");
    expect((await env.DB.prepare("SELECT count(*) AS n FROM audit_log WHERE action='DFBNET_IMPORT_COMPLETED'").first<{ n: number }>())?.n).toBe(1);
  });

  it("never persists forbidden DFBnet fields", async () => {
    const { cookieA } = await seedTwoTenants();
    const done = await SELF.fetch(url(CLUB_A, TEAM_A), { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify({ ...roster(), confirm: true }) });
    expect(done.status).toBe(201);
    const players = await env.DB.prepare("SELECT * FROM players WHERE club_id=?").bind(CLUB_A).all();
    const dump = JSON.stringify(players.results) + JSON.stringify((await env.DB.prepare("SELECT * FROM dfbnet_imports WHERE club_id=?").bind(CLUB_A).all()).results);
    expect(dump).not.toContain("0100-0001");
    expect(dump).not.toContain("01.01.2014");
    expect(players.results).toHaveLength(2);
  });

  it("is idempotent on a repeated identical roster", async () => {
    const { cookieA } = await seedTwoTenants();
    const first = await (await SELF.fetch(url(CLUB_A, TEAM_A), { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify({ ...roster(), confirm: true }) })).json<{ importId: string }>();
    const second = await SELF.fetch(url(CLUB_A, TEAM_A), { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify({ ...roster(), confirm: true }) });
    const secondBody = await second.json<{ importId: string; duplicate: boolean }>();
    expect(secondBody.importId).toBe(first.importId);
    expect(secondBody.duplicate).toBe(true);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM dfbnet_imports WHERE club_id=?").bind(CLUB_A).first<{ n: number }>())?.n).toBe(1);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM players WHERE club_id=? AND team_id=?").bind(CLUB_A, TEAM_A).first<{ n: number }>())?.n).toBe(2);
  });

  it("updates an existing player matched by externalId on re-import", async () => {
    const { cookieA } = await seedTwoTenants();
    await SELF.fetch(url(CLUB_A, TEAM_A), { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify({ ...roster(), confirm: true }) });
    const changed = { filename: "r2.csv", confirm: true, players: [{ name: "Testspieler A", firstName: "Max", shirtNumber: "10", externalId: "SYN-1" }, { name: "Testspieler B", shirtNumber: "9", externalId: "SYN-2" }] };
    await SELF.fetch(url(CLUB_A, TEAM_A), { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify(changed) });
    const player = await env.DB.prepare("SELECT shirt_number AS shirt,version FROM players WHERE club_id=? AND team_id=? AND external_id='SYN-1'").bind(CLUB_A, TEAM_A).first<{ shirt: string; version: number }>();
    expect(player?.shirt).toBe("10");
    expect(player?.version).toBe(2);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM players WHERE club_id=? AND team_id=?").bind(CLUB_A, TEAM_A).first<{ n: number }>())?.n).toBe(2);
  });

  it("keeps imports isolated per club and per team", async () => {
    const { cookieA } = await seedTwoTenants();
    await SELF.fetch(url(CLUB_A, TEAM_A), { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify({ ...roster(), confirm: true }) });
    expect((await SELF.fetch(url(CLUB_B, TEAM_B), { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify(roster()) })).status).toBe(404);
    expect((await SELF.fetch(url(CLUB_A, "aaaaaaaa-9999-4999-8999-aaaaaaaaaaaa"), { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify(roster()) })).status).toBe(404);
    const siblingList = await (await SELF.fetch(url(CLUB_A, TEAM_A2), { headers: { Cookie: cookieA } })).json<{ imports: unknown[] }>();
    expect(siblingList.imports).toHaveLength(0);
    const ownList = await (await SELF.fetch(url(CLUB_A, TEAM_A), { headers: { Cookie: cookieA } })).json<{ imports: unknown[] }>();
    expect(ownList.imports).toHaveLength(1);
  });

  it("lets a referee read import history but not start an import", async () => {
    const { cookieA } = await seedTwoTenants();
    await env.DB.prepare("UPDATE memberships SET role='referee' WHERE club_id=? AND user_id=?").bind(CLUB_A, USER_A).run();
    expect((await SELF.fetch(url(CLUB_A, TEAM_A), { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify(roster()) })).status).toBe(403);
    expect((await SELF.fetch(url(CLUB_A, TEAM_A), { headers: { Cookie: cookieA } })).status).toBe(200);
  });
});
