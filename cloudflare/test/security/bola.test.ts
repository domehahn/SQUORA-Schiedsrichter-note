import { env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CLUB_A, CLUB_B, TEAM_B, MATCH_B, ORIGIN, jsonHeaders, matchBody, migrate, resetDb, seedTwoTenants } from "../helpers";

const UNKNOWN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/** Epic 15/25 gate: User A can never observe, mutate or probe User B's tenant. */
describe("security · BOLA / IDOR", () => {
  beforeAll(migrate);
  beforeEach(resetDb);

  async function seedForeignMatch(): Promise<void> {
    const now = new Date().toISOString();
    await env.DB.prepare("INSERT INTO matches (club_id,id,match_date,competition,venue,state,payload_json,version,created_at,updated_at) VALUES (?,?,?,'Synthetic','','setup','{}',1,?,?)")
      .bind(CLUB_B, MATCH_B, "2026-09-04", now, now).run();
  }

  it("hides a foreign club, its teams, state, export and matches (404, never 403)", async () => {
    const { cookieA } = await seedTwoTenants();
    for (const path of [
      `/api/v1/clubs/${CLUB_B}`,
      `/api/v1/clubs/${CLUB_B}/teams`,
      `/api/v1/clubs/${CLUB_B}/teams/${TEAM_B}/state`,
      `/api/v1/clubs/${CLUB_B}/teams/${TEAM_B}/dfbnet/imports`,
      `/api/v1/clubs/${CLUB_B}/export`,
      `/api/v1/clubs/${CLUB_B}/matches`,
    ]) {
      expect((await SELF.fetch(`${ORIGIN}${path}`, { headers: { Cookie: cookieA } })).status, path).toBe(404);
    }
  });

  it("refuses foreign match read / update / delete", async () => {
    const { cookieA } = await seedTwoTenants();
    await seedForeignMatch();
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_B}/matches/${MATCH_B}`, { headers: { Cookie: cookieA } })).status).toBe(404);
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/matches/${MATCH_B}`, { headers: { Cookie: cookieA } })).status).toBe(404);
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_B}/matches/${MATCH_B}`, { method: "PUT", headers: jsonHeaders(cookieA), body: JSON.stringify(matchBody(1)) })).status).toBe(404);
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_B}/matches/${MATCH_B}`, { method: "DELETE", headers: jsonHeaders(cookieA), body: JSON.stringify({ version: 1 }) })).status).toBe(404);
  });

  it("refuses cross-tenant writes through a team-state PUT and a DFBnet import", async () => {
    const { cookieA } = await seedTwoTenants();
    const state = JSON.stringify({ version: 0, archive: [], deletedIds: [], tournaments: [], teams: [], current: null });
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_B}/teams/${TEAM_B}/state`, { method: "PUT", headers: jsonHeaders(cookieA), body: state })).status).toBe(404);
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_B}/teams/${TEAM_B}/dfbnet/imports`, { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify({ filename: "x.csv", players: [{ name: "X" }] }) })).status).toBe(404);
  });

  it("treats unknown ids the same as foreign ones", async () => {
    const { cookieA } = await seedTwoTenants();
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${UNKNOWN}`, { headers: { Cookie: cookieA } })).status).toBe(404);
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/teams/${UNKNOWN}/state`, { headers: { Cookie: cookieA } })).status).toBe(404);
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/matches/${UNKNOWN}`, { headers: { Cookie: cookieA } })).status).toBe(404);
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/not-a-uuid`, { headers: { Cookie: cookieA } })).status).toBe(404);
  });
});
