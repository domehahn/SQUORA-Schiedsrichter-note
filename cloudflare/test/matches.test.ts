import { env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CLUB_A, CLUB_B, MATCH_B, ORIGIN, jsonHeaders, matchBody, migrate, resetDb, seedTwoTenants } from "./helpers";

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

  it("guards whole-app synchronization by tenant and aggregate version", async () => {
    const { cookieA } = await seedTwoTenants();
    const payload = { version: 0, archive: [], deletedIds: [], tournaments: [], teams: [], current: null };
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/state`, { method: "PUT", headers: jsonHeaders(cookieA), body: JSON.stringify(payload) })).status).toBe(200);
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/state`, { method: "PUT", headers: jsonHeaders(cookieA), body: JSON.stringify(payload) })).status).toBe(409);
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_B}/state`, { method: "PUT", headers: jsonHeaders(cookieA), body: JSON.stringify(payload) })).status).toBe(404);
  });

  it("removes non-whitelisted sensitive roster metadata before persistence", async () => {
    const { cookieA } = await seedTwoTenants();
    const teamId = crypto.randomUUID();
    const playerId = crypto.randomUUID();
    const payload = {
      version: 0,
      archive: [], tournaments: [], current: null,
      teams: [{ id: teamId, name: "Synthetic team", roster: [{ id: playerId, name: "Max Testspieler", number: "7", pass: "0100-0001", birthdate: "01.01.2014" }] }],
    };
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/state`, { method: "PUT", headers: jsonHeaders(cookieA), body: JSON.stringify(payload) })).status).toBe(200);
    const response = await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/state`, { headers: { Cookie: cookieA } });
    const text = await response.text();
    expect(text).toContain("Max Testspieler");
    expect(text).not.toContain("0100-0001");
    expect(text).not.toContain("01.01.2014");
  });
});
