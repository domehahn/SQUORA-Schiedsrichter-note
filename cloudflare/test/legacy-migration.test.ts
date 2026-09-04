import { env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CLUB_A, CLUB_B, ORIGIN, TEAM_A, TEAM_A2, TEAM_B, USER_A, jsonHeaders, migrate, resetDb, seedTwoTenants } from "./helpers";

const LEGACY_ID = "legacyClubA";

async function seedLegacy(): Promise<void> {
  const prefix = "note:user-a@example.invalid";
  await env.LEGACY_DATA!.put(`${prefix}:index`, JSON.stringify({ tenants: [{ id: LEGACY_ID, name: "Legacy Test Club" }] }));
  await env.LEGACY_DATA!.put(`${prefix}:t:${LEGACY_ID}`, JSON.stringify({ iv: "synthetic-iv", ciphertext: "synthetic-ciphertext" }));
}

describe("controlled legacy KV migration", () => {
  beforeAll(migrate);
  beforeEach(async () => { await resetDb(); await env.LEGACY_DATA!.delete("note:user-a@example.invalid:index"); await env.LEGACY_DATA!.delete(`note:user-a@example.invalid:t:${LEGACY_ID}`); });

  it("verifies ownership, fingerprints and records an idempotent mapping", async () => {
    const { cookieA } = await seedTwoTenants();
    await seedLegacy();
    const source = await SELF.fetch(`${ORIGIN}/api/v1/legacy/tenants/${LEGACY_ID}/payload`, { headers: { Cookie: cookieA } });
    expect(source.status).toBe(200);
    const { sourceFingerprint } = await source.json<{ sourceFingerprint: string }>();
    const body = {
      legacyTenantId: LEGACY_ID,
      sourceFingerprint,
      data: { version: 0, archive: [], deletedIds: [], tournaments: [], teams: [], current: null },
    };
    const url = `${ORIGIN}/api/v1/clubs/${CLUB_A}/teams/${TEAM_A}/migrations/legacy`;
    expect((await SELF.fetch(url, { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify(body) })).status).toBe(201);
    const retry = await SELF.fetch(url, { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify(body) });
    expect(retry.status).toBe(200);
    expect((await retry.json<{ alreadyMigrated: boolean }>()).alreadyMigrated).toBe(true);
    const row = await env.DB.prepare("SELECT club_id AS clubId,team_id AS teamId,status FROM legacy_migrations WHERE user_id=? AND legacy_tenant_id=?").bind(USER_A, LEGACY_ID).first<{ clubId: string; teamId: string; status: string }>();
    expect(row).toEqual({ clubId: CLUB_A, teamId: TEAM_A, status: "completed" });
  });

  it("rejects foreign targets, unknown sources, remapping and stale fingerprints", async () => {
    const { cookieA } = await seedTwoTenants();
    await seedLegacy();
    const source = await SELF.fetch(`${ORIGIN}/api/v1/legacy/tenants/${LEGACY_ID}/payload`, { headers: { Cookie: cookieA } });
    const { sourceFingerprint } = await source.json<{ sourceFingerprint: string }>();
    const data = { version: 0, archive: [], deletedIds: [], tournaments: [], teams: [], current: null };
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_B}/teams/${TEAM_B}/migrations/legacy`, { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify({ legacyTenantId: LEGACY_ID, sourceFingerprint, data }) })).status).toBe(404);
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/teams/${TEAM_A}/migrations/legacy`, { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify({ legacyTenantId: "unknown", sourceFingerprint, data }) })).status).toBe(404);
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/teams/${TEAM_A}/migrations/legacy`, { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify({ legacyTenantId: LEGACY_ID, sourceFingerprint: "0".repeat(64), data }) })).status).toBe(409);
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/teams/${TEAM_A}/migrations/legacy`, { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify({ legacyTenantId: LEGACY_ID, sourceFingerprint, data }) })).status).toBe(201);
    expect((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}/teams/${TEAM_A2}/migrations/legacy`, { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify({ legacyTenantId: LEGACY_ID, sourceFingerprint, data: { ...data, version: 0 } }) })).status).toBe(409);
  });
});
