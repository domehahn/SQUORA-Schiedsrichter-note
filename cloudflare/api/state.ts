import type { AuthContext } from "../auth/session";
import { HttpError, json, readJson, requireSameOrigin } from "../core/http";
import { isId } from "../core/id";
import { boundedJson, integerValue, objectValue } from "../core/validation";
import { minimize } from "../core/dfbnet";
import { abortBatchUnlessOneChange, versionConflictOr } from "../core/optimistic";
import { requireTeamAccess } from "../middleware/tenant";
import { writeAudit } from "../services/audit-service";

function arrayValue(source: Record<string, unknown>, key: string, max: number): unknown[] {
  const value = source[key];
  if (!Array.isArray(value) || value.length > max) throw new HttpError(422, "VALIDATION_FAILED", "The request data is invalid.");
  return value;
}

function idArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value) || value.length > max) throw new HttpError(422, "VALIDATION_FAILED", "The request data is invalid.");
  return value.map((entry) => {
    if (typeof entry !== "string" || !isId(entry)) throw new HttpError(422, "VALIDATION_FAILED", "The request data is invalid.");
    return entry;
  });
}

function domainId(source: Record<string, unknown>): string {
  if (typeof source.id !== "string" || !isId(source.id)) throw new HttpError(422, "VALIDATION_FAILED", "The request data is invalid.");
  return source.id;
}

/**
 * Cross-team BOLA guard. A body id (match or tournament) that already exists in
 * this club under a *different* team must never be upserted, silently
 * reassigned or removed through this team's `/state` endpoint. A foreign id is
 * indistinguishable from a missing one → 404, no mutation.
 */
async function assertNoForeignTeamRows(db: D1Database, table: "matches" | "tournaments", club: string, team: string, ids: string[]): Promise<void> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const clash = await db.prepare(
    `SELECT 1 FROM ${table} WHERE club_id=? AND team_id<>? AND id IN (SELECT value FROM json_each(?)) LIMIT 1`,
  ).bind(club, team, JSON.stringify(unique)).first();
  if (clash) throw new HttpError(404, "NOT_FOUND", "The requested resource was not found.");
}

function matchStatus(phase: unknown): "setup" | "live" | "finished" | "abandoned" {
  if (phase === "finished") return "finished";
  if (phase === "abandoned") return "abandoned";
  if (phase === "setup") return "setup";
  return "live";
}

const RETAINED_SEASONS = 3; // current + 2 prior; a season runs 1 Aug – 31 Jul

/** ISO date (YYYY-MM-DD) before which archived matches are shed from the server DB. */
function seasonCutoff(now: Date): string {
  const seasonStartYear = now.getUTCMonth() >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return `${seasonStartYear - (RETAINED_SEASONS - 1)}-08-01`;
}

/** Whole-team synchronisation snapshot (archive, tournaments, roster library, live match). */
export async function getState(env: Env, auth: AuthContext, clubId: string, teamId: string, requestId: string): Promise<Response> {
  const context = await requireTeamAccess(env.DB, auth, clubId, teamId, "matches.read");
  const { clubId: club, teamId: team } = context;
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT OR IGNORE INTO team_sync_versions (club_id,team_id,version,updated_at) VALUES (?,?,0,?)").bind(club, team, now).run();
  const [version, matches, events, rosters, tournaments, draft] = await Promise.all([
    env.DB.prepare("SELECT version,updated_at AS updatedAt FROM team_sync_versions WHERE club_id=? AND team_id=?").bind(club, team).first<{ version: number; updatedAt: string }>(),
    env.DB.prepare("SELECT id,payload_json AS payloadJson,saved_at AS savedAt FROM matches WHERE club_id=? AND team_id=? AND deleted_at IS NULL ORDER BY saved_at DESC,id").bind(club, team).all<{ id: string; payloadJson: string; savedAt: string | null }>(),
    env.DB.prepare("SELECT match_id AS matchId,payload_json AS payloadJson FROM match_events WHERE club_id=? AND team_id=? ORDER BY match_ms,id").bind(club, team).all<{ matchId: string; payloadJson: string }>(),
    env.DB.prepare("SELECT payload_json AS payloadJson FROM team_rosters WHERE club_id=? AND team_id=?").bind(club, team).first<{ payloadJson: string }>(),
    env.DB.prepare("SELECT payload_json AS payloadJson FROM tournaments WHERE club_id=? AND team_id=? AND deleted_at IS NULL ORDER BY tournament_date DESC,id").bind(club, team).all<{ payloadJson: string }>(),
    env.DB.prepare("SELECT payload_json AS payloadJson FROM team_drafts WHERE club_id=? AND team_id=?").bind(club, team).first<{ payloadJson: string }>(),
  ]);
  const byMatch = new Map<string, unknown[]>();
  for (const event of events.results) {
    const list = byMatch.get(event.matchId) ?? [];
    list.push(JSON.parse(event.payloadJson));
    byMatch.set(event.matchId, list);
  }
  const archive = matches.results.map((row) => ({ savedAt: row.savedAt, state: { ...JSON.parse(row.payloadJson), events: byMatch.get(row.id) ?? [] } }));
  return json({
    version: version?.version ?? 0,
    updatedAt: version?.updatedAt ?? null,
    archive,
    deletedIds: [],
    teams: rosters ? JSON.parse(rosters.payloadJson) : [],
    tournaments: tournaments.results.map((row) => JSON.parse(row.payloadJson)),
    current: draft ? JSON.parse(draft.payloadJson) : null,
  }, requestId);
}

// ---- statement builders shared by the full and delta write paths ---------

interface MatchStored { payloadJson: string; savedAt: string | null }

/** Upsert one archived match + its events. Returns null when the match is unchanged or shed by season retention. */
function matchStatements(
  db: D1Database, club: string, team: string, raw: unknown, was: MatchStored | undefined, cutoff: string, now: string,
): { statements: D1PreparedStatement[]; id: string; shed: boolean } {
  const saved = objectValue(minimize(raw));
  const state = objectValue(saved.state);
  const id = domainId(state);
  const matchDate = typeof state.matchDate === "string" ? state.matchDate.slice(0, 40) : now.slice(0, 10);
  if (matchDate < cutoff) return { statements: [], id, shed: true };
  const withoutEvents = { ...state, events: undefined };
  const meta = state.meta && typeof state.meta === "object" ? state.meta as Record<string, unknown> : {};
  const payloadJson = boundedJson(withoutEvents, 512_000);
  const savedAt = typeof saved.savedAt === "string" ? saved.savedAt : now;
  if (was && was.payloadJson === payloadJson && was.savedAt === savedAt) return { statements: [], id, shed: false };

  const rawEvents = Array.isArray(state.events) ? state.events.slice(0, 1000) : [];
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT INTO matches (club_id,team_id,id,match_date,competition,venue,state,payload_json,saved_at,version,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,1,?,?)
      ON CONFLICT(club_id,id) DO UPDATE SET match_date=excluded.match_date,competition=excluded.competition,venue=excluded.venue,state=excluded.state,payload_json=excluded.payload_json,saved_at=excluded.saved_at,version=matches.version+1,updated_at=excluded.updated_at,deleted_at=NULL WHERE matches.team_id=excluded.team_id`)
      .bind(club, team, id, matchDate, typeof meta.competition === "string" ? meta.competition.slice(0, 160) : "", typeof meta.venue === "string" ? meta.venue.slice(0, 200) : "", matchStatus(state.phase), payloadJson, savedAt, now, now),
    db.prepare("DELETE FROM match_events WHERE club_id=? AND team_id=? AND match_id=?").bind(club, team, id),
  ];
  for (const rawEvent of rawEvents) {
    const event = objectValue(minimize(rawEvent));
    const eventId = domainId(event);
    const matchMs = Number.isInteger(event.matchMs) ? Math.max(0, Math.min(event.matchMs as number, 60_000_000)) : 0;
    statements.push(db.prepare("INSERT INTO match_events (club_id,team_id,id,match_id,event_type,match_ms,payload_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(club, team, eventId, id, typeof event.kind === "string" ? event.kind.slice(0, 40) : "unknown", matchMs, boundedJson(event, 32_768), now, now));
  }
  return { statements, id, shed: false };
}

/** Upsert one tournament. Returns null when unchanged. */
function tournamentStatement(
  db: D1Database, club: string, team: string, raw: unknown, wasPayload: string | undefined, now: string,
): { statement: D1PreparedStatement | null; id: string } {
  const tournament = objectValue(minimize(raw));
  const id = domainId(tournament);
  const name = typeof tournament.name === "string" ? tournament.name.trim().slice(0, 160) : "";
  if (!name) throw new HttpError(422, "VALIDATION_FAILED", "The request data is invalid.");
  const payloadJson = boundedJson(tournament, 512_000);
  if (wasPayload === payloadJson) return { statement: null, id };
  return {
    id,
    statement: db.prepare(`INSERT INTO tournaments (club_id,team_id,id,name,tournament_date,payload_json,version,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?)
      ON CONFLICT(club_id,id) DO UPDATE SET name=excluded.name,tournament_date=excluded.tournament_date,payload_json=excluded.payload_json,version=tournaments.version+1,updated_at=excluded.updated_at WHERE tournaments.team_id=excluded.team_id`)
      .bind(club, team, id, name, typeof tournament.date === "string" ? tournament.date.slice(0, 40) : null, payloadJson, now, now),
  };
}

function draftStatement(db: D1Database, club: string, team: string, current: unknown, now: string): D1PreparedStatement {
  if (current === null || current === undefined) {
    return db.prepare("DELETE FROM team_drafts WHERE club_id=? AND team_id=?").bind(club, team);
  }
  const minimized = objectValue(minimize(current));
  return db.prepare("INSERT INTO team_drafts (club_id,team_id,match_id,payload_json,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(club_id,team_id) DO UPDATE SET match_id=excluded.match_id,payload_json=excluded.payload_json,updated_at=excluded.updated_at")
    .bind(club, team, domainId(minimized), boundedJson(minimized, 1_048_576), now);
}

/**
 * Whole-team synchronisation.
 *
 * Two request shapes are accepted:
 *  - **delta** (`{ delta: true, matches: { upsert, removeIds }, tournaments: {…},
 *    teams?, current? }`): only the listed rows are touched — the normal client
 *    sync after the first load.
 *  - **full snapshot** (`{ archive, tournaments, teams, current }`): the server
 *    diffs it against what is stored and additionally sweeps rows the client no
 *    longer has. Used for bootstrap, legacy migration and offline reconciliation.
 *
 * Both paths are optimistically locked: the version bump and every data
 * statement run in one `DB.batch()` transaction guarded by
 * `abortBatchUnlessOneChange`.
 */
export async function putState(request: Request, env: Env, auth: AuthContext, clubId: string, teamId: string, requestId: string): Promise<Response> {
  requireSameOrigin(request);
  const context = await requireTeamAccess(env.DB, auth, clubId, teamId, "matches.update");
  const { clubId: club, teamId: team } = context;
  const source = objectValue(await readJson(request, 4_194_304));
  const expectedVersion = integerValue(source, "version", { min: 0, max: 2_147_483_647 });
  const isDelta = source.delta === true;
  const startedAt = new Date();
  const now = startedAt.toISOString();
  const cutoff = seasonCutoff(startedAt);

  // Inputs, normalised to { upsert, removeIds } regardless of shape.
  let matchUpsert: unknown[];
  let matchRemove: string[];
  let tournamentUpsert: unknown[];
  let tournamentRemove: string[];
  let touchRoster: unknown[] | null;
  let touchCurrent: { value: unknown } | null;
  if (isDelta) {
    const matchDelta = objectValue(source.matches ?? {});
    const tournamentDelta = objectValue(source.tournaments ?? {});
    matchUpsert = Array.isArray(matchDelta.upsert) ? arrayValue(matchDelta, "upsert", 2000) : [];
    matchRemove = idArray(matchDelta.removeIds ?? [], 2000);
    tournamentUpsert = Array.isArray(tournamentDelta.upsert) ? arrayValue(tournamentDelta, "upsert", 500) : [];
    tournamentRemove = idArray(tournamentDelta.removeIds ?? [], 500);
    touchRoster = "teams" in source ? arrayValue(source, "teams", 500) : null;
    touchCurrent = "current" in source ? { value: source.current } : null;
  } else {
    matchUpsert = arrayValue(source, "archive", 2000);
    matchRemove = [];
    tournamentUpsert = arrayValue(source, "tournaments", 500);
    tournamentRemove = [];
    touchRoster = arrayValue(source, "teams", 500);
    touchCurrent = { value: source.current ?? null };
  }

  await env.DB.prepare("INSERT OR IGNORE INTO team_sync_versions (club_id,team_id,version,updated_at) VALUES (?,?,0,?)").bind(club, team, now).run();
  const [current0, storedMatches, storedTournaments] = await Promise.all([
    env.DB.prepare("SELECT version FROM team_sync_versions WHERE club_id=? AND team_id=?").bind(club, team).first<{ version: number }>(),
    env.DB.prepare("SELECT id,payload_json AS payloadJson,saved_at AS savedAt FROM matches WHERE club_id=? AND team_id=? AND deleted_at IS NULL").bind(club, team).all<{ id: string; payloadJson: string; savedAt: string | null }>(),
    env.DB.prepare("SELECT id,payload_json AS payloadJson FROM tournaments WHERE club_id=? AND team_id=?").bind(club, team).all<{ id: string; payloadJson: string }>(),
  ]);
  if ((current0?.version ?? 0) !== expectedVersion) throw new HttpError(409, "VERSION_CONFLICT", "The team data was changed by another client.");
  const matchWas = new Map(storedMatches.results.map((row) => [row.id, { payloadJson: row.payloadJson, savedAt: row.savedAt }]));
  const tournamentWas = new Map(storedTournaments.results.map((row) => [row.id, row.payloadJson]));

  // Reject any body id that belongs to another team of this club before writing anything.
  const upsertMatchIds = matchUpsert.map((raw) => domainId(objectValue(objectValue(minimize(raw)).state)));
  const upsertTournamentIds = tournamentUpsert.map((raw) => domainId(objectValue(minimize(raw))));
  await assertNoForeignTeamRows(env.DB, "matches", club, team, [...upsertMatchIds, ...matchRemove]);
  await assertNoForeignTeamRows(env.DB, "tournaments", club, team, [...upsertTournamentIds, ...tournamentRemove]);

  const statements: D1PreparedStatement[] = [
    env.DB.prepare("UPDATE team_sync_versions SET version=version+1,updated_at=? WHERE club_id=? AND team_id=? AND version=?").bind(now, club, team, expectedVersion),
    abortBatchUnlessOneChange(env.DB, "team_sync_versions", ["club_id", "team_id"], [club, team]),
  ];
  if (touchRoster) {
    statements.push(env.DB.prepare("INSERT INTO team_rosters (club_id,team_id,payload_json,updated_at) VALUES (?,?,?,?) ON CONFLICT(club_id,team_id) DO UPDATE SET payload_json=excluded.payload_json,updated_at=excluded.updated_at")
      .bind(club, team, boundedJson(touchRoster.map((entry) => minimize(entry)), 2_000_000), now));
  }

  const matchIds: string[] = [];
  const tournamentIds: string[] = [];
  let changedMatches = 0;
  let changedTournaments = 0;
  let shedOldMatches = 0;

  for (const raw of tournamentUpsert) {
    const id = domainId(objectValue(minimize(raw)));
    const { statement } = tournamentStatement(env.DB, club, team, raw, tournamentWas.get(id), now);
    tournamentIds.push(id);
    if (statement) { changedTournaments += 1; statements.push(statement); }
  }

  for (const raw of matchUpsert) {
    const state = objectValue(objectValue(minimize(raw)).state);
    const id = domainId(state);
    const built = matchStatements(env.DB, club, team, raw, matchWas.get(id), cutoff, now);
    if (built.shed) { shedOldMatches += 1; continue; }
    matchIds.push(built.id);
    if (built.statements.length) { changedMatches += 1; statements.push(...built.statements); }
  }

  if (isDelta) {
    for (const id of matchRemove) {
      statements.push(
        env.DB.prepare("DELETE FROM match_events WHERE club_id=? AND team_id=? AND match_id=?").bind(club, team, id),
        env.DB.prepare("DELETE FROM matches WHERE club_id=? AND team_id=? AND id=?").bind(club, team, id),
      );
    }
    for (const id of tournamentRemove) {
      statements.push(env.DB.prepare("DELETE FROM tournaments WHERE club_id=? AND team_id=? AND id=?").bind(club, team, id));
    }
  } else {
    // Full snapshot: also drop rows the client no longer has.
    const matchIdJson = JSON.stringify(matchIds);
    statements.push(
      env.DB.prepare("DELETE FROM match_events WHERE club_id=? AND team_id=? AND match_id NOT IN (SELECT value FROM json_each(?))").bind(club, team, matchIdJson),
      env.DB.prepare("DELETE FROM matches WHERE club_id=? AND team_id=? AND id NOT IN (SELECT value FROM json_each(?))").bind(club, team, matchIdJson),
      env.DB.prepare("DELETE FROM tournaments WHERE club_id=? AND team_id=? AND id NOT IN (SELECT value FROM json_each(?))").bind(club, team, JSON.stringify(tournamentIds)),
    );
  }

  if (touchCurrent) statements.push(draftStatement(env.DB, club, team, touchCurrent.value, now));

  try {
    await env.DB.batch(statements);
  } catch (error) {
    await versionConflictOr(env.DB, error, { table: "team_sync_versions", where: "club_id=? AND team_id=?", binds: [club, team], expected: expectedVersion });
  }
  await writeAudit(env.DB, {
    clubId: club, userId: auth.userId, action: "TEAM_STATE_SYNCED", entityType: "team", entityId: team,
    metadata: { version: expectedVersion + 1, mode: isDelta ? "delta" : "full", changedMatches, changedTournaments, removedMatches: matchRemove.length, shedOldMatches, draft: touchCurrent && touchCurrent.value ? 1 : 0 },
  });
  return json({ ok: true, version: expectedVersion + 1, updatedAt: now }, requestId);
}
