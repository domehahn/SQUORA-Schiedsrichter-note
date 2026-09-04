import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { checkAndAlert } from "../services/alerting";
import { runRetention } from "../services/retention";
import { CLUB_A, USER_A, migrate, resetDb, seedClub, seedUser } from "./helpers";

describe("data retention cleanup", () => {
  beforeAll(migrate);
  beforeEach(resetDb);

  it("removes expired/old sessions, audit rows and import records; keeps fresh ones", async () => {
    await seedUser(USER_A, "a@example.invalid");
    await seedClub(CLUB_A, "Club A Test");
    const old = "2020-01-01T00:00:00.000Z";
    const soon = new Date(Date.now() + 3_600_000).toISOString();
    const H_EXPIRED = "e".repeat(64), H_REVOKED = "d".repeat(64), H_LIVE = "1".repeat(64);

    await env.DB.batch([
      env.DB.prepare("INSERT INTO sessions (id_hash,user_id,created_at,last_seen_at,expires_at) VALUES (?,?,?,?,?)").bind(H_EXPIRED, USER_A, old, old, old),
      env.DB.prepare("INSERT INTO sessions (id_hash,user_id,created_at,last_seen_at,expires_at,revoked_at) VALUES (?,?,?,?,?,?)").bind(H_REVOKED, USER_A, old, old, soon, old),
      env.DB.prepare("INSERT INTO sessions (id_hash,user_id,created_at,last_seen_at,expires_at) VALUES (?,?,?,?,?)").bind(H_LIVE, USER_A, old, old, soon),
      env.DB.prepare("INSERT INTO audit_log (id,club_id,user_id,action,entity_type,entity_id,metadata_json,created_at) VALUES ('11111111-1111-4111-8111-111111111aaa',?,?,'LOGIN_SUCCESS','session',NULL,'{}',?)").bind(CLUB_A, USER_A, old),
      env.DB.prepare("INSERT INTO audit_log (id,club_id,user_id,action,entity_type,entity_id,metadata_json,created_at) VALUES ('11111111-1111-4111-8111-111111111bbb',?,?,'LOGIN_SUCCESS','session',NULL,'{}',?)").bind(CLUB_A, USER_A, new Date().toISOString()),
      env.DB.prepare("INSERT INTO dfbnet_imports (club_id,id,user_id,team_id,source,filename,fingerprint,status,record_count,created_at) VALUES (?,?,?,'','dfbnet_csv','x.csv',?,'completed',0,?)")
        .bind(CLUB_A, "22222222-2222-4222-8222-222222222aaa", USER_A, "a".repeat(64), old),
    ]);

    const result = await runRetention(env.DB);
    expect(result).toMatchObject({ sessions: 2, audit: 1, imports: 1 });

    expect((await env.DB.prepare("SELECT id_hash FROM sessions").all<{ id_hash: string }>()).results.map((r) => r.id_hash)).toEqual([H_LIVE]);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM audit_log").first<{ n: number }>())?.n).toBe(1);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM dfbnet_imports").first<{ n: number }>())?.n).toBe(0);
  });

  it("alerting is a no-op without a configured webhook", async () => {
    expect(await checkAndAlert(env)).toEqual([]);
  });
});
