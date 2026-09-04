import { applyD1Migrations, env } from "cloudflare:test";
import { createSession } from "../auth/session";

export const ORIGIN = "https://example.com";
export const USER_A = "11111111-1111-4111-8111-111111111111";
export const USER_B = "22222222-2222-4222-8222-222222222222";
export const CLUB_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const CLUB_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const TEAM_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
export const TEAM_A2 = "aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa";
export const TEAM_B = "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb";
export const MATCH_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
export const TEST_PASSWORD_HASH = "pbkdf2-sha256$100000$01010101010101010101010101010101$0a5cea6a96077c89c2e719a6adaac8df9216e53b118ff99290c775c8c7346382";

export async function migrate(): Promise<void> {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS!);
}

export async function resetDb(): Promise<void> {
  for (const table of ["audit_log", "sessions", "legacy_migrations", "dfbnet_imports", "team_drafts", "team_rosters", "team_sync_versions", "match_events", "matches", "players", "tournaments", "teams", "memberships", "clubs", "users"]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
}

export async function seedTeam(clubId: string, teamId: string, name = "Synthetic team", ageGroup: string | null = "D"): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO teams (club_id,id,name,age_group,version,created_at,updated_at) VALUES (?,?,?,?,1,?,?)")
    .bind(clubId, teamId, name, ageGroup, now, now).run();
}

export async function seedUser(id: string, email: string, status = "active"): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO users (id,email,display_name,password_hash,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
    .bind(id, email, `Test user ${id.slice(0, 4)}`, TEST_PASSWORD_HASH, status, now, now).run();
}

export async function seedClub(id: string, name: string): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO clubs (id,name,slug,cache_salt,status,created_at,updated_at) VALUES (?,?,?,?, 'active',?,?)")
    .bind(id, name, `${name.toLowerCase().replaceAll(" ", "-")}-${id.slice(0, 4)}`, "AAAAAAAAAAAAAAAAAAAAAA==", now, now).run();
}

export async function seedMembership(clubId: string, userId: string, role = "club_owner", status = "active"): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO memberships (club_id,user_id,role,status,created_at,updated_at) VALUES (?,?,?,?,?,?)")
    .bind(clubId, userId, role, status, now, now).run();
}

export async function authCookie(userId: string): Promise<string> {
  const session = await createSession(env.DB, userId, new Request(ORIGIN, { headers: { "User-Agent": "SQUORA test" } }));
  return `squora_session=${session.token}`;
}

export async function seedTwoTenants(): Promise<{ cookieA: string; cookieB: string }> {
  await seedUser(USER_A, "user-a@example.invalid");
  await seedUser(USER_B, "user-b@example.invalid");
  await seedClub(CLUB_A, "Club A Test");
  await seedClub(CLUB_B, "Club B Test");
  await seedMembership(CLUB_A, USER_A);
  await seedMembership(CLUB_B, USER_B);
  await seedTeam(CLUB_A, TEAM_A, "A · D1", "D");
  await seedTeam(CLUB_A, TEAM_A2, "A · D2", "D");
  await seedTeam(CLUB_B, TEAM_B, "B · E1", "E");
  return { cookieA: await authCookie(USER_A), cookieB: await authCookie(USER_B) };
}

export function jsonHeaders(cookie: string): Record<string, string> {
  return { Cookie: cookie, Origin: ORIGIN, "Content-Type": "application/json" };
}

export function matchBody(version?: number, teamId: string = TEAM_A): Record<string, unknown> {
  return { ...(version ? { version } : {}), teamId, matchDate: "2026-09-03", competition: "Synthetic test league", venue: "Test venue", state: "setup", payload: { homeTeam: "A", awayTeam: "B" }, events: [] };
}
