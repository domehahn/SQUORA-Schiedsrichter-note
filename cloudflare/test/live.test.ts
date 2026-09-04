import { env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CLUB_A, TEAM_A, TEAM_A2, USER_A, ORIGIN, jsonHeaders, migrate, resetDb, seedTwoTenants } from "./helpers";

const stateUrl = (team: string) => `${ORIGIN}/api/v1/clubs/${CLUB_A}/teams/${team}/state`;
const shareUrl = (team: string) => `${ORIGIN}/api/v1/clubs/${CLUB_A}/teams/${team}/draft/share`;
const publicUrl = (token: string) => `${ORIGIN}/api/v1/live/${token}`;

const draftWithGoal = {
  id: "aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa",
  phase: "firstHalf",
  homeTeam: "TuS Kirchberg",
  awayTeam: "SV Testverein",
  events: [
    { id: "e1", kind: "goal", team: "home", player: "9", playerName: "Anna Meier", minute: 12, matchMs: 0, label: "Tor TuS Kirchberg · Anna Meier", exactTime: "00:12:00", createdAt: "x" },
    { id: "e2", kind: "yellow", team: "away", player: "4", playerName: "Ben Kern", minute: 30, matchMs: 0, label: "Gelb Ben Kern", exactTime: "00:30:00", createdAt: "x" },
    { id: "e3", kind: "note", team: undefined, minute: 5, matchMs: 0, label: "Vorkommnis", text: "Anna Meier verletzt am Knie", exactTime: "00:05:00", createdAt: "x" },
    { id: "e4", kind: "substitution", team: "home", playerIn: "14", playerInName: "Kim Musterkind", playerOut: "9", playerOutName: "Anna Meier", minute: 40, matchMs: 0, label: "Wechsel #9 -> #14", exactTime: "00:40:00", createdAt: "x" },
  ],
};

describe("public live ticker", () => {
  beforeAll(migrate);
  beforeEach(resetDb);

  it("refuses to share before any match is running", async () => {
    const { cookieA } = await seedTwoTenants();
    expect((await SELF.fetch(shareUrl(TEAM_A), { method: "POST", headers: jsonHeaders(cookieA) })).status).toBe(409);
  });

  it("exposes score, shirt numbers and generic events but never player names, free text, or the raw label", async () => {
    const { cookieA } = await seedTwoTenants();
    await SELF.fetch(stateUrl(TEAM_A), { method: "PUT", headers: jsonHeaders(cookieA), body: JSON.stringify({ version: 0, archive: [], deletedIds: [], tournaments: [], teams: [], current: draftWithGoal }) });

    const enabled = await SELF.fetch(shareUrl(TEAM_A), { method: "POST", headers: jsonHeaders(cookieA) });
    expect(enabled.status).toBe(200);
    const { token } = await enabled.json<{ token: string }>();
    expect(token.length).toBeGreaterThanOrEqual(40);

    const view = await SELF.fetch(publicUrl(token)); // no cookie: public
    expect(view.status).toBe(200);
    const body = await view.json<{ homeTeam: string; awayTeam: string; homeScore: number; awayScore: number; phase: string; events: { minute: number; team: string | null; label: string; detail?: string }[] }>();
    expect(body).toMatchObject({ homeTeam: "TuS Kirchberg", awayTeam: "SV Testverein", homeScore: 1, awayScore: 0, phase: "firstHalf" });
    expect(body.events).toEqual([
      { minute: 12, team: "home", label: "Tor", detail: "#9" },
      { minute: 30, team: "away", label: "Gelbe Karte", detail: "#4" },
      { minute: 40, team: "home", label: "Wechsel", detail: "#9 → #14" },
    ]);
    const dump = JSON.stringify(body);
    expect(dump).not.toContain("Anna Meier");
    expect(dump).not.toContain("Ben Kern");
    expect(dump).not.toContain("Musterkind");
    expect(dump).not.toContain("Knie");
    expect(dump).not.toContain("Vorkommnis");
  });

  it("never persists or returns the token in cleartext, and audits without it", async () => {
    const { cookieA } = await seedTwoTenants();
    await SELF.fetch(stateUrl(TEAM_A), { method: "PUT", headers: jsonHeaders(cookieA), body: JSON.stringify({ version: 0, archive: [], deletedIds: [], tournaments: [], teams: [], current: draftWithGoal }) });
    const { token } = await (await SELF.fetch(shareUrl(TEAM_A), { method: "POST", headers: jsonHeaders(cookieA) })).json<{ token: string }>();
    const stored = JSON.stringify((await env.DB.prepare("SELECT * FROM team_drafts").all()).results) + JSON.stringify((await env.DB.prepare("SELECT * FROM audit_log WHERE action LIKE 'LIVE_SHARE%'").all()).results);
    expect(stored).not.toContain(token);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM audit_log WHERE action='LIVE_SHARE_ENABLED'").first<{ n: number }>())?.n).toBe(1);
  });

  it("rotating the link invalidates the previous token; disabling removes public access", async () => {
    const { cookieA } = await seedTwoTenants();
    await SELF.fetch(stateUrl(TEAM_A), { method: "PUT", headers: jsonHeaders(cookieA), body: JSON.stringify({ version: 0, archive: [], deletedIds: [], tournaments: [], teams: [], current: draftWithGoal }) });
    const first = await (await SELF.fetch(shareUrl(TEAM_A), { method: "POST", headers: jsonHeaders(cookieA) })).json<{ token: string }>();
    const second = await (await SELF.fetch(shareUrl(TEAM_A), { method: "POST", headers: jsonHeaders(cookieA) })).json<{ token: string }>();
    expect(second.token).not.toBe(first.token);
    expect((await SELF.fetch(publicUrl(first.token))).status).toBe(404);
    expect((await SELF.fetch(publicUrl(second.token))).status).toBe(200);

    expect((await SELF.fetch(shareUrl(TEAM_A), { method: "DELETE", headers: jsonHeaders(cookieA) })).status).toBe(200);
    expect((await SELF.fetch(publicUrl(second.token))).status).toBe(404);
  });

  it("hides a bad, expired-looking or foreign token generically", async () => {
    expect((await SELF.fetch(publicUrl("not-a-real-token-not-a-real-token"))).status).toBe(404);
    expect((await SELF.fetch(publicUrl("short"))).status).toBe(404);
  });

  it("only a team-authorized member can enable or disable sharing", async () => {
    const { cookieA } = await seedTwoTenants();
    await env.DB.prepare("UPDATE memberships SET team_id=? WHERE club_id=? AND user_id=?").bind(TEAM_A2, CLUB_A, USER_A).run();
    expect((await SELF.fetch(shareUrl(TEAM_A), { method: "POST", headers: jsonHeaders(cookieA) })).status).toBe(404);
  });

  it("requires same-origin to enable or disable sharing", async () => {
    const { cookieA } = await seedTwoTenants();
    const res = await SELF.fetch(shareUrl(TEAM_A), { method: "POST", headers: { Cookie: cookieA, Origin: "https://evil.invalid", "Content-Type": "application/json" } });
    expect(res.status).toBe(403);
  });
});
