export interface RetentionResult {
  sessions: number;
  audit: number;
  imports: number;
}

const DAY_MS = 86_400_000;
const AUDIT_RETENTION_DAYS = 730; // 24 months
const IMPORT_RETENTION_DAYS = 365; // 12 months

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

  return {
    sessions: sessions.meta.changes ?? 0,
    audit: audit.meta.changes ?? 0,
    imports: imports.meta.changes ?? 0,
  };
}
