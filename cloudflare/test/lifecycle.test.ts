import { env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runClubPurge } from "../services/retention";
import {
  CLUB_A, CLUB_B, TEAM_A, USER_A, USER_B, ORIGIN,
  jsonHeaders, migrate, resetDb, seedMembership, seedTwoTenants,
} from "./helpers";

async function seedClubContent(clubId: string, teamId: string): Promise<void> {
  const now = new Date().toISOString();
  const matchId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO matches (club_id,team_id,id,match_date,competition,venue,state,payload_json,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,1,?,?)")
      .bind(clubId, teamId, matchId, "2026-09-04", "Synthetic league", "Test venue", "finished", "{}", now, now),
    env.DB.prepare("INSERT INTO match_events (club_id,team_id,id,match_id,event_type,match_ms,payload_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(clubId, teamId, crypto.randomUUID(), matchId, "goal", 60000, "{}", now, now),
    env.DB.prepare("INSERT INTO tournaments (club_id,team_id,id,name,tournament_date,payload_json,version,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?)")
      .bind(clubId, teamId, crypto.randomUUID(), "Synthetic cup", "2026-09-04", "{}", now, now),
    env.DB.prepare("INSERT INTO players (club_id,id,team_id,name,shirt_number,version,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)")
      .bind(clubId, crypto.randomUUID(), teamId, "Max Testspieler", "7", now, now),
    env.DB.prepare("INSERT INTO invitations (club_id,id,email,role,token_hash,status,expires_at,invited_by,created_at,updated_at) VALUES (?,?,?,?,?, 'pending',?,?,?,?)")
      .bind(clubId, crypto.randomUUID(), "invitee@example.invalid", "referee", crypto.randomUUID().replaceAll("-", "").padEnd(64, "0"), now, USER_A, now, now),
  ]);
}

describe("club export & lifecycle deletion", () => {
  beforeAll(migrate);
  beforeEach(resetDb);

  it("exports a full club snapshot for an owner and records an audit row", async () => {
    const { cookieA } = await seedTwoTenants();
    await seedClubContent(CLUB_A, TEAM_A);
    const response = await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/export`, { headers: { Cookie: cookieA } });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain("attachment");
    const body = await response.json<{ schemaVersion: number; matches: unknown[]; players: unknown[]; tournaments: unknown[]; memberships: unknown[] }>();
    expect(body.schemaVersion).toBe(1);
    expect(body.matches).toHaveLength(1);
    expect(body.players).toHaveLength(1);
    expect(body.tournaments).toHaveLength(1);
    expect(body.memberships).toHaveLength(1);
    const audit = await env.DB.prepare("SELECT count(*) AS n FROM audit_log WHERE club_id=? AND action='EXPORT_CREATED'").bind(CLUB_A).first<{ n: number }>();
    expect(audit?.n).toBe(1);
  });

  it("never exports a foreign club", async () => {
    const { cookieA } = await seedTwoTenants();
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_B}/export`, { headers: { Cookie: cookieA } })).status).toBe(404);
  });

  it("denies export to a member without club.manage", async () => {
    const { cookieA } = await seedTwoTenants();
    await env.DB.prepare("UPDATE memberships SET role='referee' WHERE club_id=? AND user_id=?").bind(CLUB_A, USER_A).run();
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/export`, { headers: { Cookie: cookieA } })).status).toBe(403);
  });

  it("schedules deletion with a grace window; cancel restores; the cron purges once due", async () => {
    const { cookieA } = await seedTwoTenants();
    await seedClubContent(CLUB_A, TEAM_A);

    // schedule
    const del = await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}`, { method: "DELETE", headers: jsonHeaders(cookieA), body: JSON.stringify({ confirm: "Club A Test" }) });
    expect(del.status).toBe(200);
    expect((await del.json<{ deletionDueAt: string }>()).deletionDueAt).toMatch(/^20\d\d-/u);
    const scheduled = await env.DB.prepare("SELECT status,deletion_due_at AS due FROM clubs WHERE id=?").bind(CLUB_A).first<{ status: string; due: string }>();
    expect(scheduled).toMatchObject({ status: "deleted" });
    expect(scheduled?.due).toBeTruthy();
    // invisible to tenant queries, data still present during the window
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}`, { headers: { Cookie: cookieA } })).status).toBe(404);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM matches WHERE club_id=?").bind(CLUB_A).first<{ n: number }>())?.n).toBe(1);

    // cancel restores it
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/deletion/cancel`, { method: "POST", headers: jsonHeaders(cookieA) })).status).toBe(200);
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}`, { headers: { Cookie: cookieA } })).status).toBe(200);

    // re-schedule, then force the window to the past and run the cron
    await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}`, { method: "DELETE", headers: jsonHeaders(cookieA), body: JSON.stringify({ confirm: "Club A Test" }) });
    await env.DB.prepare("UPDATE clubs SET deletion_due_at='2020-01-01T00:00:00.000Z' WHERE id=?").bind(CLUB_A).run();
    const purged = await runClubPurge(env.DB);
    expect(purged).toEqual([CLUB_A]);
    for (const table of ["matches", "match_events", "tournaments", "players", "teams", "memberships", "invitations", "legacy_migrations"]) {
      expect((await env.DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE club_id=?`).bind(CLUB_A).first<{ n: number }>())?.n, table).toBe(0);
    }
    expect((await env.DB.prepare("SELECT count(*) AS n FROM clubs WHERE id=?").bind(CLUB_A).first<{ n: number }>())?.n).toBe(0);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM clubs WHERE id=?").bind(CLUB_B).first<{ n: number }>())?.n).toBe(1);
    const audit = await env.DB.prepare("SELECT metadata_json AS m FROM audit_log WHERE action='CLUB_DELETED'").first<{ m: string }>();
    expect(JSON.parse(audit!.m)).toMatchObject({ name: "Club A Test", reason: "grace_window_elapsed" });
  });

  it("rejects club deletion by a non-owner and on a bad confirmation", async () => {
    const { cookieA } = await seedTwoTenants();
    await env.DB.prepare("UPDATE memberships SET role='club_admin' WHERE club_id=? AND user_id=?").bind(CLUB_A, USER_A).run();
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}`, { method: "DELETE", headers: jsonHeaders(cookieA), body: JSON.stringify({ confirm: "Club A Test" }) })).status).toBe(403);
    await env.DB.prepare("UPDATE memberships SET role='club_owner' WHERE club_id=? AND user_id=?").bind(CLUB_A, USER_A).run();
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}`, { method: "DELETE", headers: jsonHeaders(cookieA), body: JSON.stringify({ confirm: "wrong" }) })).status).toBe(422);
  });

  it("deletes the caller's account, tombstones the user and revokes sessions", async () => {
    const { cookieA } = await seedTwoTenants(); // USER_A solely owns CLUB_A
    await seedClubContent(CLUB_A, TEAM_A);
    const response = await SELF.fetch(`${ORIGIN}/api/v1/me`, { method: "DELETE", headers: jsonHeaders(cookieA), body: JSON.stringify({ confirm: "KONTO LÖSCHEN" }) });
    expect(response.status).toBe(200);
    expect((await response.json<{ purgedClubs: number }>()).purgedClubs).toBe(1);
    const user = await env.DB.prepare("SELECT email,status FROM users WHERE id=?").bind(USER_A).first<{ email: string; status: string }>();
    expect(user?.status).toBe("deleted");
    expect(user?.email).toBe(`deleted-${USER_A}@deleted.invalid`);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM memberships WHERE user_id=?").bind(USER_A).first<{ n: number }>())?.n).toBe(0);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM clubs WHERE id=?").bind(CLUB_A).first<{ n: number }>())?.n).toBe(0);
    expect((await SELF.fetch(`${ORIGIN}/api/v1/me`, { headers: { Cookie: cookieA } })).status).toBe(401);
  });

  it("blocks account deletion while the user solely owns a club with other members", async () => {
    const { cookieA } = await seedTwoTenants();
    await seedMembership(CLUB_A, USER_B, "referee", "active");
    const response = await SELF.fetch(`${ORIGIN}/api/v1/me`, { method: "DELETE", headers: jsonHeaders(cookieA), body: JSON.stringify({ confirm: "KONTO LÖSCHEN" }) });
    expect(response.status).toBe(409);
    expect((await env.DB.prepare("SELECT status FROM users WHERE id=?").bind(USER_A).first<{ status: string }>())?.status).toBe("active");
  });

  it("rejects account deletion without the exact confirmation phrase", async () => {
    const { cookieA } = await seedTwoTenants();
    expect((await SELF.fetch(`${ORIGIN}/api/v1/me`, { method: "DELETE", headers: jsonHeaders(cookieA), body: JSON.stringify({ confirm: "delete" }) })).status).toBe(422);
  });
});
