import type { AuthContext } from "../auth/session";
import { json } from "../core/http";
import { requireTenantAccess } from "../middleware/tenant";
import { writeAudit } from "../services/audit-service";

const SCHEMA_VERSION = 1;

/**
 * Full portable copy of one club's data (GDPR portability / pre-deletion safety
 * net). Requires `club.manage`. Never spans clubs; excludes credentials, session
 * tokens and raw DFBnet CSVs. Private-note ciphertext is included opaquely.
 */
export async function exportClub(env: Env, auth: AuthContext, clubId: string, requestId: string): Promise<Response> {
  const context = await requireTenantAccess(env.DB, auth, clubId, "club.manage");
  const club = context.clubId;

  const [clubRow, teams, players, matches, events, tournaments, members, imports, audit] = await Promise.all([
    env.DB.prepare("SELECT id,name,slug,dfb_club_id AS dfbClubId,status,created_at AS createdAt,updated_at AS updatedAt FROM clubs WHERE id=?").bind(club).first(),
    env.DB.prepare("SELECT id,name,dfb_team_id AS dfbTeamId,age_group AS ageGroup,created_at AS createdAt,updated_at AS updatedAt FROM teams WHERE club_id=? ORDER BY name,id").bind(club).all(),
    env.DB.prepare("SELECT id,team_id AS teamId,external_id AS externalId,name,shirt_number AS shirtNumber,created_at AS createdAt,updated_at AS updatedAt FROM players WHERE club_id=? ORDER BY team_id,name").bind(club).all(),
    env.DB.prepare("SELECT id,team_id AS teamId,match_date AS matchDate,competition,venue,state,payload_json AS payloadJson,version,saved_at AS savedAt,created_at AS createdAt,updated_at AS updatedAt,deleted_at AS deletedAt FROM matches WHERE club_id=? ORDER BY match_date DESC,id").bind(club).all<{ id: string; payloadJson: string }>(),
    env.DB.prepare("SELECT id,match_id AS matchId,event_type AS eventType,match_ms AS matchMs,payload_json AS payloadJson,created_at AS createdAt FROM match_events WHERE club_id=? ORDER BY match_id,match_ms,id").bind(club).all<{ matchId: string; payloadJson: string }>(),
    env.DB.prepare("SELECT id,team_id AS teamId,name,tournament_date AS tournamentDate,payload_json AS payloadJson,version,created_at AS createdAt,updated_at AS updatedAt,deleted_at AS deletedAt FROM tournaments WHERE club_id=? ORDER BY tournament_date DESC,id").bind(club).all<{ id: string; payloadJson: string }>(),
    env.DB.prepare("SELECT u.id AS userId,u.email,u.display_name AS displayName,m.role,m.status,m.team_id AS teamId,m.created_at AS createdAt FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.club_id=? ORDER BY m.role,u.email").bind(club).all(),
    env.DB.prepare("SELECT id,user_id AS userId,source,filename,fingerprint,status,record_count AS recordCount,created_at AS createdAt,completed_at AS completedAt,error_summary AS errorSummary FROM dfbnet_imports WHERE club_id=? ORDER BY created_at DESC,id").bind(club).all(),
    env.DB.prepare("SELECT id,user_id AS userId,action,entity_type AS entityType,entity_id AS entityId,metadata_json AS metadataJson,created_at AS createdAt FROM audit_log WHERE club_id=? ORDER BY created_at DESC,id LIMIT 5000").bind(club).all<{ metadataJson: string }>(),
  ]);

  const eventsByMatch = new Map<string, unknown[]>();
  for (const event of events.results) {
    const list = eventsByMatch.get(event.matchId) ?? [];
    list.push({ ...event, payload: JSON.parse(event.payloadJson), payloadJson: undefined, matchId: undefined });
    eventsByMatch.set(event.matchId, list);
  }

  const body = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    club: clubRow,
    teams: teams.results,
    players: players.results,
    matches: matches.results.map((row) => ({ ...row, payload: JSON.parse(row.payloadJson), payloadJson: undefined, events: eventsByMatch.get(row.id) ?? [] })),
    tournaments: tournaments.results.map((row) => ({ ...row, payload: JSON.parse(row.payloadJson), payloadJson: undefined })),
    memberships: members.results,
    dfbnetImports: imports.results,
    auditLog: audit.results.map((row) => ({ ...row, metadata: JSON.parse(row.metadataJson), metadataJson: undefined })),
  };

  await writeAudit(env.DB, {
    clubId: club,
    userId: auth.userId,
    action: "EXPORT_CREATED",
    entityType: "club",
    entityId: club,
    metadata: { matches: body.matches.length, players: body.players.length, tournaments: body.tournaments.length },
  });

  const response = json(body, requestId);
  response.headers.set("Content-Disposition", `attachment; filename="squora-club-${club}.json"`);
  return response;
}
