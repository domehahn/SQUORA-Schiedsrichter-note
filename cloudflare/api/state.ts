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

function domainId(source: Record<string, unknown>): string {
  if (typeof source.id !== "string" || !isId(source.id)) throw new HttpError(422, "VALIDATION_FAILED", "The request data is invalid.");
  return source.id;
}

function matchStatus(phase: unknown): "setup" | "live" | "finished" | "abandoned" {
  if (phase === "finished") return "finished";
  if (phase === "abandoned") return "abandoned";
  if (phase === "setup") return "setup";
  return "live";
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

export async function putState(request: Request, env: Env, auth: AuthContext, clubId: string, teamId: string, requestId: string): Promise<Response> {
  requireSameOrigin(request);
  const context = await requireTeamAccess(env.DB, auth, clubId, teamId, "matches.update");
  const { clubId: club, teamId: team } = context;
  const source = objectValue(await readJson(request, 4_194_304));
  const expectedVersion = integerValue(source, "version", { min: 0, max: 2_147_483_647 });
  const archive = arrayValue(source, "archive", 2000);
  const rosterLibrary = arrayValue(source, "teams", 500);
  const tournaments = arrayValue(source, "tournaments", 500);
  const current = source.current === null || source.current === undefined ? null : objectValue(source.current);
  const now = new Date().toISOString();

  await env.DB.prepare("INSERT OR IGNORE INTO team_sync_versions (club_id,team_id,version,updated_at) VALUES (?,?,0,?)").bind(club, team, now).run();

  // Read the stored snapshot so the batch can write only what actually changed
  // instead of DELETE-ALL + INSERT-ALL on every 1.5 s client sync.
  const [current0, storedMatches, storedTournaments] = await Promise.all([
    env.DB.prepare("SELECT version FROM team_sync_versions WHERE club_id=? AND team_id=?").bind(club, team).first<{ version: number }>(),
    env.DB.prepare("SELECT id,payload_json AS payloadJson,saved_at AS savedAt FROM matches WHERE club_id=? AND team_id=? AND deleted_at IS NULL").bind(club, team).all<{ id: string; payloadJson: string; savedAt: string | null }>(),
    env.DB.prepare("SELECT id,payload_json AS payloadJson FROM tournaments WHERE club_id=? AND team_id=?").bind(club, team).all<{ id: string; payloadJson: string }>(),
  ]);
  if ((current0?.version ?? 0) !== expectedVersion) throw new HttpError(409, "VERSION_CONFLICT", "The team data was changed by another client.");
  const matchWas = new Map(storedMatches.results.map((row) => [row.id, row]));
  const tournamentWas = new Map(storedTournaments.results.map((row) => [row.id, row.payloadJson]));

  // The version bump and every data statement run in one batch (= one D1
  // transaction). The guard aborts the whole batch if a racing writer bumped
  // the version between the check above and the batch.
  const matchIds: string[] = [];
  const tournamentIds: string[] = [];
  let changedMatches = 0;
  let changedTournaments = 0;

  const statements: D1PreparedStatement[] = [
    env.DB.prepare("UPDATE team_sync_versions SET version=version+1,updated_at=? WHERE club_id=? AND team_id=? AND version=?").bind(now, club, team, expectedVersion),
    abortBatchUnlessOneChange(env.DB, "team_sync_versions", ["club_id", "team_id"], [club, team]),
    env.DB.prepare("INSERT INTO team_rosters (club_id,team_id,payload_json,updated_at) VALUES (?,?,?,?) ON CONFLICT(club_id,team_id) DO UPDATE SET payload_json=excluded.payload_json,updated_at=excluded.updated_at")
      .bind(club, team, boundedJson(rosterLibrary.map((entry) => minimize(entry)), 2_000_000), now),
  ];

  for (const raw of tournaments) {
    const tournament = objectValue(minimize(raw));
    const id = domainId(tournament);
    tournamentIds.push(id);
    const name = typeof tournament.name === "string" ? tournament.name.trim().slice(0, 160) : "";
    if (!name) throw new HttpError(422, "VALIDATION_FAILED", "The request data is invalid.");
    const payloadJson = boundedJson(tournament, 512_000);
    if (tournamentWas.get(id) === payloadJson) continue; // unchanged
    changedTournaments += 1;
    statements.push(env.DB.prepare(`INSERT INTO tournaments (club_id,team_id,id,name,tournament_date,payload_json,version,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?)
      ON CONFLICT(club_id,id) DO UPDATE SET name=excluded.name,tournament_date=excluded.tournament_date,payload_json=excluded.payload_json,version=tournaments.version+1,updated_at=excluded.updated_at`)
      .bind(club, team, id, name, typeof tournament.date === "string" ? tournament.date.slice(0, 40) : null, payloadJson, now, now));
  }

  for (const raw of archive) {
    const saved = objectValue(minimize(raw));
    const state = objectValue(saved.state);
    const id = domainId(state);
    matchIds.push(id);
    const rawEvents = Array.isArray(state.events) ? state.events.slice(0, 1000) : [];
    const withoutEvents = { ...state, events: undefined };
    const meta = state.meta && typeof state.meta === "object" ? state.meta as Record<string, unknown> : {};
    const payloadJson = boundedJson(withoutEvents, 512_000);
    const savedAt = typeof saved.savedAt === "string" ? saved.savedAt : now;
    const was = matchWas.get(id);
    if (was && was.payloadJson === payloadJson && was.savedAt === savedAt) continue; // match + events unchanged
    changedMatches += 1;
    statements.push(env.DB.prepare(`INSERT INTO matches (club_id,team_id,id,match_date,competition,venue,state,payload_json,saved_at,version,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,1,?,?)
      ON CONFLICT(club_id,id) DO UPDATE SET team_id=excluded.team_id,match_date=excluded.match_date,competition=excluded.competition,venue=excluded.venue,state=excluded.state,payload_json=excluded.payload_json,saved_at=excluded.saved_at,version=matches.version+1,updated_at=excluded.updated_at,deleted_at=NULL`)
      .bind(club, team, id, typeof state.matchDate === "string" ? state.matchDate.slice(0, 40) : now.slice(0, 10), typeof meta.competition === "string" ? meta.competition.slice(0, 160) : "", typeof meta.venue === "string" ? meta.venue.slice(0, 200) : "", matchStatus(state.phase), payloadJson, savedAt, now, now));
    statements.push(env.DB.prepare("DELETE FROM match_events WHERE club_id=? AND match_id=?").bind(club, id));
    for (const rawEvent of rawEvents) {
      const event = objectValue(minimize(rawEvent));
      const eventId = domainId(event);
      const matchMs = Number.isInteger(event.matchMs) ? Math.max(0, Math.min(event.matchMs as number, 60_000_000)) : 0;
      statements.push(env.DB.prepare("INSERT INTO match_events (club_id,team_id,id,match_id,event_type,match_ms,payload_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(club, team, eventId, id, typeof event.kind === "string" ? event.kind.slice(0, 40) : "unknown", matchMs, boundedJson(event, 32_768), now, now));
    }
  }

  // Drop rows the client no longer has. json_each avoids a bound-parameter blow-up.
  const matchIdJson = JSON.stringify(matchIds);
  statements.push(
    env.DB.prepare("DELETE FROM match_events WHERE club_id=? AND team_id=? AND match_id NOT IN (SELECT value FROM json_each(?))").bind(club, team, matchIdJson),
    env.DB.prepare("DELETE FROM matches WHERE club_id=? AND team_id=? AND id NOT IN (SELECT value FROM json_each(?))").bind(club, team, matchIdJson),
    env.DB.prepare("DELETE FROM tournaments WHERE club_id=? AND team_id=? AND id NOT IN (SELECT value FROM json_each(?))").bind(club, team, JSON.stringify(tournamentIds)),
  );

  if (current) {
    const minimized = objectValue(minimize(current));
    statements.push(env.DB.prepare("INSERT INTO team_drafts (club_id,team_id,match_id,payload_json,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(club_id,team_id) DO UPDATE SET match_id=excluded.match_id,payload_json=excluded.payload_json,updated_at=excluded.updated_at")
      .bind(club, team, domainId(minimized), boundedJson(minimized, 1_048_576), now));
  } else {
    statements.push(env.DB.prepare("DELETE FROM team_drafts WHERE club_id=? AND team_id=?").bind(club, team));
  }

  try {
    await env.DB.batch(statements);
  } catch (error) {
    await versionConflictOr(env.DB, error, { table: "team_sync_versions", where: "club_id=? AND team_id=?", binds: [club, team], expected: expectedVersion });
  }
  await writeAudit(env.DB, {
    clubId: club, userId: auth.userId, action: "TEAM_STATE_SYNCED", entityType: "team", entityId: team,
    metadata: { version: expectedVersion + 1, archive: archive.length, tournaments: tournaments.length, changedMatches, changedTournaments, draft: current ? 1 : 0 },
  });
  return json({ ok: true, version: expectedVersion + 1, updatedAt: now }, requestId);
}
