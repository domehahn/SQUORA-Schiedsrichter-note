import { env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CLUB_A, TEAM_A, ORIGIN, jsonHeaders, matchBody, migrate, resetDb, seedTwoTenants } from "../helpers";

/** Epic 17/25 gate: parallel writers are detected, never silently merged. */
describe("security · concurrency", () => {
  beforeAll(migrate);
  beforeEach(resetDb);

  it("detects a stale match update with 409", async () => {
    const { cookieA } = await seedTwoTenants();
    const created = await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/matches`, { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify(matchBody()) });
    const id = (await created.json<{ match: { id: string } }>()).match.id;
    const first = await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/matches/${id}`, { method: "PUT", headers: jsonHeaders(cookieA), body: JSON.stringify(matchBody(1)) });
    expect(first.status).toBe(200);
    const stale = await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/matches/${id}`, { method: "PUT", headers: jsonHeaders(cookieA), body: JSON.stringify(matchBody(1)) });
    expect(stale.status).toBe(409);
  });

  it("serialises whole-team state writes by aggregate version", async () => {
    const { cookieA } = await seedTwoTenants();
    const body = () => JSON.stringify({ version: 0, archive: [], deletedIds: [], tournaments: [], teams: [], current: null });
    const url = `${ORIGIN}/api/v1/clubs/${CLUB_A}/teams/${TEAM_A}/state`;
    expect((await SELF.fetch(url, { method: "PUT", headers: jsonHeaders(cookieA), body: body() })).status).toBe(200);
    expect((await SELF.fetch(url, { method: "PUT", headers: jsonHeaders(cookieA), body: body() })).status).toBe(409);
  });

  it("keeps the version bump atomic under two truly parallel team-state writes", async () => {
    const { cookieA } = await seedTwoTenants();
    const url = `${ORIGIN}/api/v1/clubs/${CLUB_A}/teams/${TEAM_A}/state`;
    const body = JSON.stringify({ version: 0, archive: [], deletedIds: [], tournaments: [], teams: [], current: null });
    const [a, b] = await Promise.all([
      SELF.fetch(url, { method: "PUT", headers: jsonHeaders(cookieA), body }),
      SELF.fetch(url, { method: "PUT", headers: jsonHeaders(cookieA), body }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const row = await env.DB.prepare("SELECT version FROM team_sync_versions WHERE club_id=? AND team_id=?").bind(CLUB_A, TEAM_A).first<{ version: number }>();
    expect(row?.version).toBe(1); // exactly one write landed, never +2
  });

  it("keeps a match update atomic under two truly parallel writers", async () => {
    const { cookieA } = await seedTwoTenants();
    const created = await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/matches`, { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify(matchBody()) });
    const id = (await created.json<{ match: { id: string } }>()).match.id;
    const [a, b] = await Promise.all([
      SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/matches/${id}`, { method: "PUT", headers: jsonHeaders(cookieA), body: JSON.stringify(matchBody(1)) }),
      SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/matches/${id}`, { method: "PUT", headers: jsonHeaders(cookieA), body: JSON.stringify(matchBody(1)) }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const row = await env.DB.prepare("SELECT version FROM matches WHERE club_id=? AND id=?").bind(CLUB_A, id).first<{ version: number }>();
    expect(row?.version).toBe(2);
  });
});
