import { env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CLUB_A, TEAM_A, TEAM_A2, USER_A, ORIGIN, jsonHeaders, migrate, resetDb, seedTwoTenants } from "../helpers";

const MATCH_X = "aaaaaaaa-7777-4777-8777-aaaaaaaaaaaa";
const TOUR_X = "aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa";
const stateUrl = (team: string) => `${ORIGIN}/api/v1/clubs/${CLUB_A}/teams/${team}/state`;

const snapshot = (extra: Record<string, unknown>) => JSON.stringify({
  version: 0, archive: [], deletedIds: [], tournaments: [], teams: [], current: null, ...extra,
});

/**
 * Epic 1/16 gate: a body id (match / tournament) that lives in another team of
 * the same club must never be upserted, silently reassigned or removed through
 * a different team's /state endpoint — even for a club-wide member who is
 * authorized for both teams.
 */
describe("security · cross-team BOLA via /state body ids", () => {
  beforeAll(migrate);
  beforeEach(resetDb);

  async function seedTeamAResources(cookie: string): Promise<void> {
    const put = await SELF.fetch(stateUrl(TEAM_A2), {
      method: "PUT", headers: jsonHeaders(cookie),
      body: snapshot({
        archive: [{ savedAt: "2026-09-01T10:00:00.000Z", state: { id: MATCH_X, matchDate: "2026-09-01", phase: "setup", meta: { competition: "Team A2 cup" }, events: [] } }],
        tournaments: [{ id: TOUR_X, name: "Team A2 tournament", date: "2026-09-01" }],
      }),
    });
    expect(put.status).toBe(200);
  }

  it("rejects an upsert of a sibling team's match id (404, row untouched)", async () => {
    const { cookieA } = await seedTwoTenants();
    await seedTeamAResources(cookieA);
    const before = await env.DB.prepare("SELECT team_id AS teamId,version,payload_json AS payload FROM matches WHERE club_id=? AND id=?").bind(CLUB_A, MATCH_X).first<{ teamId: string; version: number; payload: string }>();

    const attack = await SELF.fetch(stateUrl(TEAM_A), {
      method: "PUT", headers: jsonHeaders(cookieA),
      body: JSON.stringify({ version: 0, delta: true, matches: { upsert: [{ savedAt: "2026-09-05T00:00:00.000Z", state: { id: MATCH_X, matchDate: "2026-09-05", phase: "finished", meta: {}, events: [] } }], removeIds: [] }, tournaments: { upsert: [], removeIds: [] } }),
    });
    expect(attack.status).toBe(404);

    const after = await env.DB.prepare("SELECT team_id AS teamId,version,payload_json AS payload FROM matches WHERE club_id=? AND id=?").bind(CLUB_A, MATCH_X).first<{ teamId: string; version: number; payload: string }>();
    expect(after).toEqual(before);
    expect(after?.teamId).toBe(TEAM_A2);
  });

  it("rejects a remove of a sibling team's match id (404, row still present)", async () => {
    const { cookieA } = await seedTwoTenants();
    await seedTeamAResources(cookieA);
    const attack = await SELF.fetch(stateUrl(TEAM_A), {
      method: "PUT", headers: jsonHeaders(cookieA),
      body: JSON.stringify({ version: 0, delta: true, matches: { upsert: [], removeIds: [MATCH_X] }, tournaments: { upsert: [], removeIds: [] } }),
    });
    expect(attack.status).toBe(404);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM matches WHERE club_id=? AND id=? AND team_id=?").bind(CLUB_A, MATCH_X, TEAM_A2).first<{ n: number }>())?.n).toBe(1);
  });

  it("rejects an upsert of a sibling team's tournament id (404, row untouched)", async () => {
    const { cookieA } = await seedTwoTenants();
    await seedTeamAResources(cookieA);
    const before = await env.DB.prepare("SELECT team_id AS teamId,name,version FROM tournaments WHERE club_id=? AND id=?").bind(CLUB_A, TOUR_X).first();
    const attack = await SELF.fetch(stateUrl(TEAM_A), {
      method: "PUT", headers: jsonHeaders(cookieA),
      body: JSON.stringify({ version: 0, delta: true, matches: { upsert: [], removeIds: [] }, tournaments: { upsert: [{ id: TOUR_X, name: "stolen", date: "2026-09-05" }], removeIds: [] } }),
    });
    expect(attack.status).toBe(404);
    expect(await env.DB.prepare("SELECT team_id AS teamId,name,version FROM tournaments WHERE club_id=? AND id=?").bind(CLUB_A, TOUR_X).first()).toEqual(before);
  });

  it("still denies a team-scoped member the sibling team's state entirely", async () => {
    const { cookieA } = await seedTwoTenants();
    await env.DB.prepare("UPDATE memberships SET team_id=? WHERE club_id=? AND user_id=?").bind(TEAM_A, CLUB_A, USER_A).run();
    expect((await SELF.fetch(stateUrl(TEAM_A2), { headers: { Cookie: cookieA } })).status).toBe(404);
    expect((await SELF.fetch(stateUrl(TEAM_A), { headers: { Cookie: cookieA } })).status).toBe(200);
  });
});
