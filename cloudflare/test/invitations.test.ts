import { env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CLUB_A, CLUB_B, TEAM_A, USER_A, USER_B, ORIGIN, authCookie, jsonHeaders, migrate, resetDb, seedUser, seedTwoTenants } from "./helpers";

const inviteUrl = (club: string, suffix = "") => `${ORIGIN}/api/v1/clubs/${club}/invitations${suffix}`;
const create = (cookie: string, club: string, body: Record<string, unknown>) =>
  SELF.fetch(inviteUrl(club), { method: "POST", headers: jsonHeaders(cookie), body: JSON.stringify(body) });

describe("invitation lifecycle", () => {
  beforeAll(migrate);
  beforeEach(resetDb);

  it("creates a pending invitation with a token and no membership yet", async () => {
    const { cookieA } = await seedTwoTenants();
    const res = await create(cookieA, CLUB_A, { email: "newbie@example.invalid", role: "referee" });
    expect(res.status).toBe(201);
    const body = await res.json<{ invitation: { id: string; status: string }; token: string }>();
    expect(body.invitation.status).toBe("pending");
    expect(body.token.length).toBeGreaterThanOrEqual(40);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM memberships WHERE club_id=?").bind(CLUB_A).first<{ n: number }>())?.n).toBe(1); // still just the owner
    expect((await env.DB.prepare("SELECT count(*) AS n FROM users WHERE email='newbie@example.invalid'").first<{ n: number }>())?.n).toBe(0);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM audit_log WHERE action='INVITATION_CREATED'").first<{ n: number }>())?.n).toBe(1);
    // token is not stored in cleartext or in the audit
    const dump = JSON.stringify((await env.DB.prepare("SELECT token_hash FROM invitations").all()).results) + JSON.stringify((await env.DB.prepare("SELECT metadata_json FROM audit_log").all()).results);
    expect(dump).not.toContain(body.token);
  });

  it("never auto-activates an existing account on invite creation", async () => {
    const { cookieA } = await seedTwoTenants();
    await seedUser("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "existing@example.invalid");
    const res = await create(cookieA, CLUB_A, { email: "existing@example.invalid", role: "viewer" });
    expect(res.status).toBe(201);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM memberships WHERE club_id=? AND user_id=?").bind(CLUB_A, "cccccccc-cccc-4ccc-8ccc-cccccccccccc").first<{ n: number }>())?.n).toBe(0);
  });

  it("rejects inviting someone who is already an active member", async () => {
    const { cookieA } = await seedTwoTenants();
    await env.DB.prepare("INSERT INTO memberships (club_id,user_id,role,status,created_at,updated_at) VALUES (?,?,?,'active',?,?)")
      .bind(CLUB_A, USER_B, "referee", new Date().toISOString(), new Date().toISOString()).run();
    const email = (await env.DB.prepare("SELECT email FROM users WHERE id=?").bind(USER_B).first<{ email: string }>())?.email;
    expect((await create(cookieA, CLUB_A, { email, role: "viewer" })).status).toBe(409);
  });

  it("is denied to a team-scoped member", async () => {
    const { cookieA } = await seedTwoTenants();
    await env.DB.prepare("UPDATE memberships SET team_id=? WHERE club_id=? AND user_id=?").bind(TEAM_A, CLUB_A, USER_A).run();
    expect((await create(cookieA, CLUB_A, { email: "x@example.invalid", role: "referee" })).status).toBe(404);
  });

  it("exposes only minimal info on the public view and hides bad tokens", async () => {
    const { cookieA } = await seedTwoTenants();
    const { token } = await (await create(cookieA, CLUB_A, { email: "look@example.invalid", role: "referee", teamId: TEAM_A })).json<{ token: string }>();
    const view = await SELF.fetch(`${ORIGIN}/api/v1/invitations/${token}`);
    expect(view.status).toBe(200);
    const body = await view.json<{ invitation: Record<string, unknown> }>();
    expect(Object.keys(body.invitation).sort()).toEqual(["clubName", "expiresAt", "role", "teamName"]);
    expect((await SELF.fetch(`${ORIGIN}/api/v1/invitations/deadbeefdeadbeefdeadbeef`)).status).toBe(404);
  });

  it("registers a new account from a token: user + membership active, invite one-time", async () => {
    const { cookieA } = await seedTwoTenants();
    const { token } = await (await create(cookieA, CLUB_A, { email: "fresh@example.invalid", role: "referee" })).json<{ token: string }>();
    const reg = await SELF.fetch(`${ORIGIN}/api/v1/auth/register`, {
      method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ token, displayName: "Fresh Tester", password: "correct horse battery" }),
    });
    expect(reg.status).toBe(201);
    expect(reg.headers.get("Set-Cookie")).toMatch(/squora_session=/);
    const user = await env.DB.prepare("SELECT id,status FROM users WHERE email='fresh@example.invalid'").first<{ id: string; status: string }>();
    expect(user?.status).toBe("active");
    const membership = await env.DB.prepare("SELECT role,status FROM memberships WHERE club_id=? AND user_id=?").bind(CLUB_A, user!.id).first<{ role: string; status: string }>();
    expect(membership).toEqual({ role: "referee", status: "active" });
    expect((await env.DB.prepare("SELECT status FROM invitations WHERE club_id=?").bind(CLUB_A).first<{ status: string }>())?.status).toBe("accepted");
    // token cannot be reused
    const replay = await SELF.fetch(`${ORIGIN}/api/v1/auth/register`, {
      method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ token, displayName: "Replay", password: "another good passphrase" }),
    });
    expect(replay.status).toBe(404);
  });

  it("lets an existing signed-in user accept only when the email matches", async () => {
    const { cookieA } = await seedTwoTenants();
    await seedUser("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "guest@example.invalid");
    const cookieGuest = await authCookie("dddddddd-dddd-4ddd-8ddd-dddddddddddd");

    const wrong = await (await create(cookieA, CLUB_A, { email: "someone-else@example.invalid", role: "viewer" })).json<{ token: string }>();
    expect((await SELF.fetch(`${ORIGIN}/api/v1/invitations/accept`, { method: "POST", headers: jsonHeaders(cookieGuest), body: JSON.stringify({ token: wrong.token }) })).status).toBe(403);

    const right = await (await create(cookieA, CLUB_A, { email: "guest@example.invalid", role: "referee_manager" })).json<{ token: string }>();
    const ok = await SELF.fetch(`${ORIGIN}/api/v1/invitations/accept`, { method: "POST", headers: jsonHeaders(cookieGuest), body: JSON.stringify({ token: right.token }) });
    expect(ok.status).toBe(201);
    expect((await env.DB.prepare("SELECT role,status FROM memberships WHERE club_id=? AND user_id=?").bind(CLUB_A, "dddddddd-dddd-4ddd-8ddd-dddddddddddd").first())).toEqual({ role: "referee_manager", status: "active" });
  });

  it("stops honouring a revoked token", async () => {
    const { cookieA } = await seedTwoTenants();
    const { invitation, token } = await (await create(cookieA, CLUB_A, { email: "revoke@example.invalid", role: "viewer" })).json<{ invitation: { id: string }; token: string }>();
    expect((await SELF.fetch(inviteUrl(CLUB_A, `/${invitation.id}`), { method: "DELETE", headers: { Cookie: cookieA, Origin: ORIGIN } })).status).toBe(200);
    expect((await SELF.fetch(`${ORIGIN}/api/v1/invitations/${token}`)).status).toBe(404);
  });

  it("keeps invitations scoped to their club (foreign admin cannot revoke)", async () => {
    const { cookieA, cookieB } = await seedTwoTenants();
    const { invitation } = await (await create(cookieA, CLUB_A, { email: "scope@example.invalid", role: "viewer" })).json<{ invitation: { id: string } }>();
    expect((await SELF.fetch(inviteUrl(CLUB_B, `/${invitation.id}`), { method: "DELETE", headers: { Cookie: cookieB, Origin: ORIGIN } })).status).toBe(404);
    expect((await SELF.fetch(inviteUrl(CLUB_A, `/${invitation.id}`), { method: "DELETE", headers: { Cookie: cookieB, Origin: ORIGIN } })).status).toBe(404);
  });

  it("rejects an expired token and marks it expired", async () => {
    const { cookieA } = await seedTwoTenants();
    const { invitation, token } = await (await create(cookieA, CLUB_A, { email: "old@example.invalid", role: "viewer" })).json<{ invitation: { id: string }; token: string }>();
    await env.DB.prepare("UPDATE invitations SET expires_at=? WHERE club_id=? AND id=?").bind("2000-01-01T00:00:00.000Z", CLUB_A, invitation.id).run();
    expect((await SELF.fetch(`${ORIGIN}/api/v1/invitations/${token}`)).status).toBe(404);
    expect((await env.DB.prepare("SELECT status FROM invitations WHERE club_id=? AND id=?").bind(CLUB_A, invitation.id).first<{ status: string }>())?.status).toBe("expired");
  });
});
