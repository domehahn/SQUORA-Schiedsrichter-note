import { env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CLUB_A, CLUB_B, TEAM_A, TEAM_A2, TEAM_B, USER_A, ORIGIN, jsonHeaders, migrate, resetDb, seedTwoTenants } from "./helpers";

const roster = (extra: Record<string, unknown>[] = []) => ({
  filename: "synthetic-roster.csv",
  players: [
    { name: "Testspieler A", firstName: "Max", lastName: "Testspieler A", shirtNumber: "7", externalId: "SYN-1", birthdate: "01.01.2014", passNumber: "0100-0001", nationality: "XX" },
    { name: "Testspieler B", firstName: "Anna", lastName: "Testspieler B", shirtNumber: "9", externalId: "SYN-2" },
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
    const players = await env.DB.prepare("SELECT name,first_name AS firstName,last_name AS lastName,shirt_number AS shirt,pass_number AS pass,birthdate FROM players WHERE club_id=? AND team_id=? ORDER BY name").bind(CLUB_A, TEAM_A).all<{ name: string; firstName: string | null; lastName: string | null; shirt: string; pass: string | null; birthdate: string | null }>();
    expect(players.results.map((p) => p.name)).toEqual(["Testspieler A", "Testspieler B"]);
    expect(players.results[0]).toMatchObject({ firstName: "Max", lastName: "Testspieler A", pass: "0100-0001", birthdate: "01.01.2014" });
    expect(players.results[1]).toMatchObject({ firstName: "Anna", lastName: "Testspieler B", pass: null, birthdate: null });
    const row = await env.DB.prepare("SELECT status FROM dfbnet_imports WHERE club_id=? AND id=?").bind(CLUB_A, importId).first<{ status: string }>();
    expect(row?.status).toBe("completed");
    expect((await env.DB.prepare("SELECT count(*) AS n FROM audit_log WHERE action='DFBNET_IMPORT_COMPLETED'").first<{ n: number }>())?.n).toBe(1);
  });

  it("keeps pass number + birthdate on the roster row but strips club-external attributes", async () => {
    const { cookieA } = await seedTwoTenants();
    const done = await SELF.fetch(url(CLUB_A, TEAM_A), { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify({ ...roster(), confirm: true }) });
    expect(done.status).toBe(201);
    const players = await env.DB.prepare("SELECT * FROM players WHERE club_id=?").bind(CLUB_A).all();
    expect(players.results).toHaveLength(2);
    // pass number + birthdate are retained for the passport check
    const dump = JSON.stringify(players.results);
    expect(dump).toContain("0100-0001");
    expect(dump).toContain("01.01.2014");
    // club-external attributes never land anywhere
    expect(dump).not.toContain("\"XX\"");
    expect(dump).not.toContain("nationality");
    const imports = JSON.stringify((await env.DB.prepare("SELECT * FROM dfbnet_imports WHERE club_id=?").bind(CLUB_A).all()).results);
    expect(imports).not.toContain("0100-0001"); // identity data is not copied into the import metadata
    expect(imports).not.toContain("01.01.2014");
  });

  it("rejects a malformed birthdate", async () => {
    const { cookieA } = await seedTwoTenants();
    const bad = { filename: "b.csv", confirm: true, players: [{ name: "Testspieler A", externalId: "SYN-1", birthdate: "not-a-date" }] };
    expect((await SELF.fetch(url(CLUB_A, TEAM_A), { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify(bad) })).status).toBe(422);
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

  it("merge keeps dropped players; replace reconciles the roster to exactly the import", async () => {
    const { cookieA } = await seedTwoTenants();
    const names = () => env.DB.prepare("SELECT name FROM players WHERE club_id=? AND team_id=? ORDER BY name").bind(CLUB_A, TEAM_A).all<{ name: string }>();

    // seed A, B, C
    const seed = { filename: "r.csv", confirm: true, players: [
      { name: "Player A", externalId: "X-1" },
      { name: "Player B", externalId: "X-2" },
      { name: "Player C", externalId: "X-3" },
    ] };
    await SELF.fetch(url(CLUB_A, TEAM_A), { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify(seed) });
    expect((await names()).results.map((r) => r.name)).toEqual(["Player A", "Player B", "Player C"]);

    // merge without C -> C stays
    const withoutC = { filename: "r2.csv", confirm: true, mode: "merge", players: [
      { name: "Player A", externalId: "X-1" }, { name: "Player B", externalId: "X-2" },
    ] };
    await SELF.fetch(url(CLUB_A, TEAM_A), { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify(withoutC) });
    expect((await names()).results.map((r) => r.name)).toEqual(["Player A", "Player B", "Player C"]);

    // replace without C -> C removed
    const replace = { ...withoutC, filename: "r3.csv", mode: "replace" };
    const done = await SELF.fetch(url(CLUB_A, TEAM_A), { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify(replace) });
    expect(done.status).toBe(201);
    expect((await names()).results.map((r) => r.name)).toEqual(["Player A", "Player B"]);

    const audit = await env.DB.prepare("SELECT metadata_json AS m FROM audit_log WHERE action='DFBNET_IMPORT_COMPLETED' ORDER BY created_at DESC").first<{ m: string }>();
    expect(JSON.parse(audit!.m).mode).toBe("replace");
  });

  it("replace also removes a manually added player without an externalId", async () => {
    const { cookieA } = await seedTwoTenants();
    await env.DB.prepare("INSERT INTO players (club_id,id,team_id,external_id,name,shirt_number,version,created_at,updated_at) VALUES (?,?,?,NULL,?,?,1,?,?)")
      .bind(CLUB_A, crypto.randomUUID(), TEAM_A, "Manuell Zusatz", "99", new Date().toISOString(), new Date().toISOString()).run();
    await SELF.fetch(url(CLUB_A, TEAM_A), { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify({ filename: "r.csv", confirm: true, mode: "replace", players: [{ name: "Player A", externalId: "X-1" }] }) });
    const rows = await env.DB.prepare("SELECT name FROM players WHERE club_id=? AND team_id=?").bind(CLUB_A, TEAM_A).all<{ name: string }>();
    expect(rows.results.map((r) => r.name)).toEqual(["Player A"]);
  });
});
