/**
 * Hard-deletes a club and every row scoped to it, leaf tables first so the
 * delete succeeds regardless of whether foreign keys are enforced on the
 * connection. `audit_log` rows are kept; their `club_id` FK is
 * `ON DELETE SET NULL`, so the audit trail survives the club.
 */
export async function purgeClub(db: D1Database, clubId: string): Promise<Record<string, number>> {
  const tables = [
    "match_events",
    "matches",
    "tournaments",
    "players",
    "team_drafts",
    "team_rosters",
    "team_sync_versions",
    "teams",
    "dfbnet_imports",
    "memberships",
  ];
  const counts: Record<string, number> = {};
  const statements = tables.map((table) => db.prepare(`DELETE FROM ${table} WHERE club_id=?`).bind(clubId));
  statements.push(db.prepare("DELETE FROM clubs WHERE id=?").bind(clubId));
  const results = await db.batch(statements);
  results.forEach((result, index) => {
    counts[index < tables.length ? tables[index] : "clubs"] = result.meta.changes ?? 0;
  });
  return counts;
}
