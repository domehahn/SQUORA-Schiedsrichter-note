import { newId } from "../core/id";

export async function writeAudit(db: D1Database, entry: {
  clubId?: string | null;
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
}): Promise<void> {
  await db.prepare(`INSERT INTO audit_log (id,club_id,user_id,action,entity_type,entity_id,metadata_json,created_at)
    VALUES (?,?,?,?,?,?,?,?)`).bind(
      newId(), entry.clubId ?? null, entry.userId ?? null, entry.action.slice(0, 80), entry.entityType.slice(0, 80),
      entry.entityId?.slice(0, 64) ?? null, JSON.stringify(entry.metadata ?? {}), new Date().toISOString(),
    ).run();
}

