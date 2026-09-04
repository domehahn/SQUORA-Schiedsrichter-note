import { HttpError } from "./http";

/**
 * Belt-and-suspenders guard for optimistic locking. Placed immediately after a
 * `UPDATE … SET version = version + 1 WHERE … AND version = ?` inside a
 * `D1Database.batch()`, it aborts the whole batch (via a constraint violation)
 * unless that UPDATE changed exactly one row. This makes the version bump atomic
 * with the data mutation in the same transaction: a racing writer that already
 * bumped the version leaves `changes() = 0`, the guard fires, and the batch —
 * version bump plus every data statement — rolls back together.
 *
 * `keyColumns` must be the target table's primary key (so the fallback INSERT
 * always collides when the guard fires). A no-op when the preceding statement
 * changed one row.
 */
export function abortBatchUnlessOneChange(
  db: D1Database,
  table: string,
  keyColumns: readonly string[],
  keyValues: readonly unknown[],
): D1PreparedStatement {
  const cols = keyColumns.join(",");
  const holes = keyColumns.map(() => "?").join(",");
  return db
    .prepare(`INSERT INTO ${table} (${cols}) SELECT ${holes} WHERE (SELECT changes()) <> 1`)
    .bind(...keyValues);
}

/**
 * Re-classify a failed optimistic-locked batch. After a rollback the row's
 * version is back to its pre-batch value, so if it no longer equals the version
 * the client sent, another writer won the race → 409. Otherwise the failure was
 * something else → rethrow so it surfaces as an internal error.
 */
export async function versionConflictOr(
  db: D1Database,
  error: unknown,
  check: { table: string; where: string; binds: readonly unknown[]; expected: number },
): Promise<never> {
  const row = await db
    .prepare(`SELECT version FROM ${check.table} WHERE ${check.where}`)
    .bind(...check.binds)
    .first<{ version: number }>();
  if (!row || row.version !== check.expected) {
    throw new HttpError(409, "VERSION_CONFLICT", "The data was changed by another client.");
  }
  throw error;
}
