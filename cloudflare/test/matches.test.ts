import { env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CLUB_A, CLUB_B, MATCH_B, TEAM_A, TEAM_A2, TEAM_B, ORIGIN, jsonHeaders, matchBody, migrate, resetDb, seedTwoTenants } from "./helpers";

describe("match isolation and optimistic locking", () => {
  beforeAll(migrate);
  beforeEach(resetDb);

  async function seedForeignMatch(): Promise<void> {
    const now = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO matches (club_id,id,match_date,competition,venue,state,payload_json,version,created_at,updated_at) VALUES (?,?,?,'Synthetic','','setup','{}',1,?,?)`).bind(CLUB_B, MATCH_B, "2026-09-03", now, now).run();
  }

  it("creates and reads only within the authorized club", async () => {
    const { cookieA } = await seedTwoTenants();
    const created = await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/matches`, { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify(matchBody()) });
    expect(created.status).toBe(201);
    const id = (await created.json<{ match: { id: string } }>()).match.id;
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/matches/${id}`, { headers: { Cookie: cookieA } })).status).toBe(200);
    const list = await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/matches?limit=1`, { headers: { Cookie: cookieA } });
    expect((await list.json<{ matches: unknown[] }>()).matches).toHaveLength(1);
  });

  it("returns 404 for foreign match reads, updates and deletes", async () => {
    const { cookieA } = await seedTwoTenants();
    await seedForeignMatch();
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_B}/matches/${MATCH_B}`, { headers: { Cookie: cookieA } })).status).toBe(404);
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/matches/${MATCH_B}`, { headers: { Cookie: cookieA } })).status).toBe(404);
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_B}/matches/${MATCH_B}`, { method: "PUT", headers: jsonHeaders(cookieA), body: JSON.stringify(matchBody(1)) })).status).toBe(404);
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_B}/matches/${MATCH_B}`, { method: "DELETE", headers: jsonHeaders(cookieA), body: JSON.stringify({ version: 1 }) })).status).toBe(404);
  });

  it("detects concurrent updates instead of silently overwriting", async () => {
    const { cookieA } = await seedTwoTenants();
    const created = await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/matches`, { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify(matchBody()) });
    const id = (await created.json<{ match: { id: string } }>()).match.id;
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/matches/${id}`, { method: "PUT", headers: jsonHeaders(cookieA), body: JSON.stringify(matchBody(1)) })).status).toBe(200);
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/matches/${id}`, { method: "PUT", headers: jsonHeaders(cookieA), body: JSON.stringify(matchBody(1)) })).status).toBe(409);
  });

  it("database constraints reject an event pointing at another club's match", async () => {
    await seedTwoTenants();
    await seedForeignMatch();
    const now = new Date().toISOString();
    await expect(env.DB.prepare(`INSERT INTO match_events (club_id,id,match_id,event_type,match_ms,payload_json,created_at,updated_at) VALUES (?,?,?,?,0,'{}',?,?)`).bind(CLUB_A, crypto.randomUUID(), MATCH_B, "goal", now, now).run()).rejects.toThrow();
  });

  it("guards whole-team synchronization by team and aggregate version", async () => {
    const { cookieA } = await seedTwoTenants();
    const payload = { version: 0, archive: [], deletedIds: [], tournaments: [], teams: [], current: null };
    const url = (club: string, team: string) => `${ORIGIN}/api/v1/clubs/${club}/teams/${team}/state`;
    expect((await SELF.fetch(url(CLUB_A, TEAM_A), { method: "PUT", headers: jsonHeaders(cookieA), body: JSON.stringify(payload) })).status).toBe(200);
    expect((await SELF.fetch(url(CLUB_A, TEAM_A), { method: "PUT", headers: jsonHeaders(cookieA), body: JSON.stringify(payload) })).status).toBe(409);
    // sibling team D2 has its own independent version → still accepts version 0
    expect((await SELF.fetch(url(CLUB_A, TEAM_A2), { method: "PUT", headers: jsonHeaders(cookieA), body: JSON.stringify(payload) })).status).toBe(200);
    // foreign club's team → 404, never reachable
    expect((await SELF.fetch(url(CLUB_B, TEAM_B), { method: "PUT", headers: jsonHeaders(cookieA), body: JSON.stringify(payload) })).status).toBe(404);
    // unknown team id within own club → 404
    expect((await SELF.fetch(url(CLUB_A, "aaaaaaaa-9999-4999-8999-aaaaaaaaaaaa"), { headers: { Cookie: cookieA } })).status).toBe(404);
  });

  it("keeps each team's live match / clock and archive separate", async () => {
    const { cookieA } = await seedTwoTenants();
    const url = (team: string) => `${ORIGIN}/api/v1/clubs/${CLUB_A}/teams/${team}/state`;
    const draft = (team: string, running: number) => ({
      version: 0, archive: [], deletedIds: [], tournaments: [], teams: [],
      current: { id: `${team.slice(0, 8)}-2222-4222-8222-${team.slice(-12)}`, phase: "live", runningSince: running, events: [] },
    });
    await SELF.fetch(url(TEAM_A), { method: "PUT", headers: jsonHeaders(cookieA), body: JSON.stringify(draft(TEAM_A, 1000)) });
    await SELF.fetch(url(TEAM_A2), { method: "PUT", headers: jsonHeaders(cookieA), body: JSON.stringify(draft(TEAM_A2, 9999)) });
    const d1 = await (await SELF.fetch(url(TEAM_A), { headers: { Cookie: cookieA } })).json<{ current: { runningSince: number } }>();
    const d2 = await (await SELF.fetch(url(TEAM_A2), { headers: { Cookie: cookieA } })).json<{ current: { runningSince: number } }>();
    expect(d1.current.runningSince).toBe(1000);
    expect(d2.current.runningSince).toBe(9999);
  });

  it("removes non-whitelisted sensitive roster metadata before persistence", async () => {
    const { cookieA } = await seedTwoTenants();
    const url = `${ORIGIN}/api/v1/clubs/${CLUB_A}/teams/${TEAM_A}/state`;
    const teamId = crypto.randomUUID();
    const playerId = crypto.randomUUID();
    const payload = {
      version: 0,
      archive: [], tournaments: [], current: null,
      teams: [{ id: teamId, name: "Synthetic team", roster: [{ id: playerId, name: "Max Testspieler", number: "7", pass: "0100-0001", birthdate: "01.01.2014" }] }],
    };
    expect((await SELF.fetch(url, { method: "PUT", headers: jsonHeaders(cookieA), body: JSON.stringify(payload) })).status).toBe(200);
    const text = await (await SELF.fetch(url, { headers: { Cookie: cookieA } })).text();
    expect(text).toContain("Max Testspieler");
    expect(text).not.toContain("0100-0001");
    expect(text).not.toContain("01.01.2014");
  });
});
