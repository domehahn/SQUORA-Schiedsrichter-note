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

  it("creates and reads only within the authorized club, persisting team_id", async () => {
    const { cookieA } = await seedTwoTenants();
    const created = await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/matches`, { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify(matchBody()) });
    expect(created.status).toBe(201);
    const id = (await created.json<{ match: { id: string } }>()).match.id;
    const read = await (await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/matches/${id}`, { headers: { Cookie: cookieA } })).json<{ match: { teamId: string } }>();
    expect(read.match.teamId).toBe(TEAM_A);
    const list = await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/matches?limit=1`, { headers: { Cookie: cookieA } });
    expect((await list.json<{ matches: unknown[] }>()).matches).toHaveLength(1);
  });

  it("rejects a match create/update whose team belongs to another club", async () => {
    const { cookieA } = await seedTwoTenants();
    const res = await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/matches`, { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify(matchBody(undefined, TEAM_B)) });
    expect(res.status).toBe(422);
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

  it("writes the whole-team sync incrementally: unchanged rows are not rewritten", async () => {
    const { cookieA } = await seedTwoTenants();
    const url = `${ORIGIN}/api/v1/clubs/${CLUB_A}/teams/${TEAM_A}/state`;
    const savedMatch = (id: string, savedAt: string, phase = "finished") => ({ savedAt, state: { id, phase, matchDate: "2026-09-04", meta: {}, events: [] } });
    const put = (version: number, archive: unknown[]) => SELF.fetch(url, { method: "PUT", headers: jsonHeaders(cookieA), body: JSON.stringify({ version, archive, deletedIds: [], tournaments: [], teams: [], current: null }) });

    const A = "aaaaaaaa-7777-4777-8777-aaaaaaaaaaaa";
    const B = "bbbbbbbb-7777-4777-8777-bbbbbbbbbbbb";
    const C = "cccccccc-7777-4777-8777-cccccccccccc";

    await put(0, [savedMatch(A, "2026-09-04T10:00:00Z"), savedMatch(B, "2026-09-04T10:00:00Z")]);
    const first = await env.DB.prepare("SELECT id,version,updated_at AS u FROM matches WHERE club_id=? AND team_id=? ORDER BY id").bind(CLUB_A, TEAM_A).all<{ id: string; version: number; u: string }>();
    expect(first.results.map((r) => r.id)).toEqual([A, B]);

    // re-sync: A unchanged, B changed (new savedAt), C new, (implicitly) nothing removed yet
    await put(1, [savedMatch(A, "2026-09-04T10:00:00Z"), savedMatch(B, "2026-09-04T11:30:00Z"), savedMatch(C, "2026-09-04T11:30:00Z")]);
    const second = await env.DB.prepare("SELECT id,version,updated_at AS u FROM matches WHERE club_id=? AND team_id=? ORDER BY id").bind(CLUB_A, TEAM_A).all<{ id: string; version: number; u: string }>();
    const byId = Object.fromEntries(second.results.map((r) => [r.id, r]));
    expect(byId[A].version).toBe(1);            // untouched
    expect(byId[A].u).toBe(first.results[0].u); // updated_at unchanged
    expect(byId[B].version).toBe(2);            // rewritten
    expect(byId[C].version).toBe(1);            // inserted

    // re-sync without B -> B removed, A/C stay
    await put(2, [savedMatch(A, "2026-09-04T10:00:00Z"), savedMatch(C, "2026-09-04T11:30:00Z")]);
    const third = await env.DB.prepare("SELECT id FROM matches WHERE club_id=? AND team_id=? ORDER BY id").bind(CLUB_A, TEAM_A).all<{ id: string }>();
    expect(third.results.map((r) => r.id)).toEqual([A, C]);

    const audit = await env.DB.prepare("SELECT metadata_json AS m FROM audit_log WHERE action='TEAM_STATE_SYNCED' ORDER BY created_at").all<{ m: string }>();
    expect(JSON.parse(audit.results[1].m).changedMatches).toBe(2); // B + C, not A
  });

  it("applies a delta sync: only the listed rows are touched, nothing swept", async () => {
    const { cookieA } = await seedTwoTenants();
    const url = `${ORIGIN}/api/v1/clubs/${CLUB_A}/teams/${TEAM_A}/state`;
    const recent = new Date().toISOString().slice(0, 10);
    const sm = (id: string, note = "") => ({ savedAt: `${recent}T10:00:00Z`, state: { id, phase: "finished", matchDate: recent, meta: { venue: note }, events: [] } });
    const A = "aaaaaaaa-9999-4999-8999-aaaaaaaaaaaa";
    const B = "bbbbbbbb-9999-4999-8999-bbbbbbbbbbbb";
    const C = "cccccccc-9999-4999-8999-cccccccccccc";

    // full snapshot -> A, B
    await SELF.fetch(url, { method: "PUT", headers: jsonHeaders(cookieA), body: JSON.stringify({ version: 0, archive: [sm(A), sm(B)], deletedIds: [], tournaments: [], teams: [], current: null }) });

    // delta at version 1: change B, remove A, add C, leave (implicit) nothing else
    const res = await SELF.fetch(url, { method: "PUT", headers: jsonHeaders(cookieA), body: JSON.stringify({
      version: 1, delta: true,
      matches: { upsert: [sm(B, "Platz 2"), sm(C)], removeIds: [A] },
      tournaments: { upsert: [], removeIds: [] },
    }) });
    expect(res.status).toBe(200);

    const rows = await env.DB.prepare("SELECT id,version FROM matches WHERE club_id=? AND team_id=? ORDER BY id").bind(CLUB_A, TEAM_A).all<{ id: string; version: number }>();
    expect(rows.results.map((r) => r.id)).toEqual([B, C]); // A removed, C added
    expect(rows.results.find((r) => r.id === B)?.version).toBe(2); // B rewritten
    const audit = await env.DB.prepare("SELECT metadata_json AS m FROM audit_log WHERE action='TEAM_STATE_SYNCED' ORDER BY created_at DESC").first<{ m: string }>();
    const meta = JSON.parse(audit!.m);
    expect(meta.mode).toBe("delta");
    expect(meta.removedMatches).toBe(1);
  });

  it("sheds archived matches older than the retained season window from the server", async () => {
    const { cookieA } = await seedTwoTenants();
    const url = `${ORIGIN}/api/v1/clubs/${CLUB_A}/teams/${TEAM_A}/state`;
    const recent = new Date().toISOString().slice(0, 10);
    const savedMatch = (id: string, matchDate: string) => ({ savedAt: `${matchDate}T10:00:00Z`, state: { id, phase: "finished", matchDate, meta: {}, events: [] } });
    const NEW = "aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa";
    const OLD = "bbbbbbbb-8888-4888-8888-bbbbbbbbbbbb";

    const put = await SELF.fetch(url, { method: "PUT", headers: jsonHeaders(cookieA), body: JSON.stringify({
      version: 0, archive: [savedMatch(NEW, recent), savedMatch(OLD, "2019-05-01")], deletedIds: [], tournaments: [], teams: [], current: null,
    }) });
    expect(put.status).toBe(200);

    const rows = await env.DB.prepare("SELECT id FROM matches WHERE club_id=? AND team_id=?").bind(CLUB_A, TEAM_A).all<{ id: string }>();
    expect(rows.results.map((r) => r.id)).toEqual([NEW]); // the 2019 match is not persisted
    const audit = await env.DB.prepare("SELECT metadata_json AS m FROM audit_log WHERE action='TEAM_STATE_SYNCED' ORDER BY created_at DESC").first<{ m: string }>();
    expect(JSON.parse(audit!.m).shedOldMatches).toBe(1);
  });

  it("keeps the pass number but strips the birthdate from the roster library blob", async () => {
    const { cookieA } = await seedTwoTenants();
    const url = `${ORIGIN}/api/v1/clubs/${CLUB_A}/teams/${TEAM_A}/state`;
    const teamId = crypto.randomUUID();
    const playerId = crypto.randomUUID();
    const payload = {
      version: 0,
      archive: [], tournaments: [], current: null,
      teams: [{ id: teamId, name: "Synthetic team", roster: [{ id: playerId, name: "Max Testspieler", number: "7", pass: "0100-0001", birthdate: "01.01.2014", nationality: "XX" }] }],
    };
    expect((await SELF.fetch(url, { method: "PUT", headers: jsonHeaders(cookieA), body: JSON.stringify(payload) })).status).toBe(200);
    const text = await (await SELF.fetch(url, { headers: { Cookie: cookieA } })).text();
    expect(text).toContain("Max Testspieler");
    expect(text).toContain("0100-0001"); // pass number belongs on the referee match sheet
    expect(text).not.toContain("01.01.2014"); // birthdate only ever lives on the players table
    expect(text).not.toContain("\"XX\""); // club-external attribute stripped
  });
});
