import { purgeClub } from "./club-deletion";

export interface RetentionResult {
  sessions: number;
  audit: number;
  imports: number;
  invitations: number;
  passwordResetTokens: number;
  purgedClubs: number;
}

/** Hard-deletes clubs whose 30-day deletion grace window has elapsed. */
export async function runClubPurge(db: D1Database, now: Date = new Date()): Promise<string[]> {
  const due = await db
    .prepare("SELECT id,name FROM clubs WHERE status='deleted' AND deletion_due_at IS NOT NULL AND deletion_due_at <= ?")
    .bind(now.toISOString())
    .all<{ id: string; name: string }>();
  for (const club of due.results) {
    await db.prepare("INSERT INTO audit_log (id,club_id,user_id,action,entity_type,entity_id,metadata_json,created_at) VALUES (?,?,NULL,'CLUB_DELETED','club',?,?,?)")
      .bind(crypto.randomUUID(), club.id, club.id, JSON.stringify({ clubId: club.id, name: club.name, reason: "grace_window_elapsed" }), now.toISOString())
      .run();
    await purgeClub(db, club.id);
  }
  return due.results.map((club) => club.id);
}

const DAY_MS = 86_400_000;
const AUDIT_RETENTION_DAYS = 730; // 24 months
const IMPORT_RETENTION_DAYS = 365; // 12 months
const INVITATION_RETENTION_DAYS = 90; // terminal (accepted/revoked/expired) invitations

/**
 * Rolling data-retention cleanup (docs/privacy/DATA_RETENTION.md). Idempotent —
 * safe to run on any schedule. Returns rows removed per table.
 */
export async function runRetention(db: D1Database, now: Date = new Date()): Promise<RetentionResult> {
  const iso = (d: Date) => d.toISOString();
  const daysAgo = (n: number) => iso(new Date(now.getTime() - n * DAY_MS));

  const sessions = await db
    .prepare("DELETE FROM sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)")
    .bind(iso(now), daysAgo(1))
    .run();
  const audit = await db
    .prepare("DELETE FROM audit_log WHERE created_at < ?")
    .bind(daysAgo(AUDIT_RETENTION_DAYS))
    .run();
  const imports = await db
    .prepare("DELETE FROM dfbnet_imports WHERE created_at < ?")
    .bind(daysAgo(IMPORT_RETENTION_DAYS))
    .run();
  // Age out invitations: flip long-past-expiry pending tokens to 'expired', then
  // drop terminal (accepted / revoked / expired) rows after the retention window.
  await db.prepare("UPDATE invitations SET status='expired',updated_at=? WHERE status='pending' AND expires_at < ?")
    .bind(iso(now), iso(now))
    .run();
  const invitations = await db
    .prepare("DELETE FROM invitations WHERE status IN ('accepted','revoked','expired') AND updated_at < ?")
    .bind(daysAgo(INVITATION_RETENTION_DAYS))
    .run();
  // Password-reset tokens are short-lived (30 min) by design; drop expired
  // ones immediately and used ones after a short window (kept briefly for
  // audit correlation, not because they're still valid — they're single-use).
  const passwordResetTokens = await db
    .prepare("DELETE FROM password_reset_tokens WHERE expires_at < ? OR (used_at IS NOT NULL AND used_at < ?)")
    .bind(iso(now), daysAgo(7))
    .run();
  const purgedClubs = await runClubPurge(db, now);

  return {
    sessions: sessions.meta.changes ?? 0,
    audit: audit.meta.changes ?? 0,
    imports: imports.meta.changes ?? 0,
    invitations: invitations.meta.changes ?? 0,
    passwordResetTokens: passwordResetTokens.meta.changes ?? 0,
    purgedClubs: purgedClubs.length,
  };
}
