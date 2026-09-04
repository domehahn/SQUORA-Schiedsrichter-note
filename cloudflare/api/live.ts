import type { AuthContext } from "../auth/session";
import { sha256 } from "../auth/session";
import { clientIp, enforceRateLimit } from "../core/rate-limit";
import { HttpError, json, requireSameOrigin } from "../core/http";
import { requireTeamAccess } from "../middleware/tenant";
import { writeAudit } from "../services/audit-service";

const NOT_FOUND = new HttpError(404, "NOT_FOUND", "The requested resource was not found.");

/**
 * Public live-ticker labels. Deliberately generic — never the stored free-text
 * `label`/`text`/player-name fields, which the referee's own device may show
 * but a public unauthenticated page never does.
 */
const PUBLIC_EVENT_LABELS: Record<string, string> = {
  goal: "Tor", ownGoal: "Tor", penaltyGoal: "Tor (Elfmeter)", penaltyMissed: "Elfmeter verschossen",
  yellow: "Gelbe Karte", yellowRed: "Gelb-Rote Karte", red: "Rote Karte",
  timePenalty: "Zeitstrafe", substitution: "Wechsel",
};

interface DraftEvent { kind?: unknown; team?: unknown; minute?: unknown }
interface DraftPayload { homeTeam?: unknown; awayTeam?: unknown; phase?: unknown; events?: unknown }

function mintToken(): { token: string; tokenHash: Promise<string> } {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const token = btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
  return { token, tokenHash: sha256(token) };
}

/** Turn the referee's live draft into the public feed shape: score, generic event log, no PII. */
function publicView(payloadJson: string, updatedAt: string): Record<string, unknown> {
  let payload: DraftPayload = {};
  try { payload = JSON.parse(payloadJson) as DraftPayload; } catch { /* leave empty */ }
  const rawEvents = Array.isArray(payload.events) ? payload.events as DraftEvent[] : [];
  let homeScore = 0;
  let awayScore = 0;
  const events: { minute: number; team: string | null; label: string }[] = [];
  for (const event of rawEvents) {
    const kind = typeof event.kind === "string" ? event.kind : "";
    const team = event.team === "home" || event.team === "away" ? event.team : null;
    const minute = Number.isInteger(event.minute) ? (event.minute as number) : 0;
    if (kind === "goal" || kind === "penaltyGoal") { if (team === "home") homeScore += 1; else if (team === "away") awayScore += 1; }
    if (kind === "ownGoal") { if (team === "home") awayScore += 1; else if (team === "away") homeScore += 1; }
    const label = PUBLIC_EVENT_LABELS[kind];
    if (label) events.push({ minute, team, label });
  }
  return {
    homeTeam: typeof payload.homeTeam === "string" ? payload.homeTeam.slice(0, 40) || "Heim" : "Heim",
    awayTeam: typeof payload.awayTeam === "string" ? payload.awayTeam.slice(0, 40) || "Gast" : "Gast",
    phase: typeof payload.phase === "string" ? payload.phase : "setup",
    homeScore,
    awayScore,
    events: events.slice(-100),
    updatedAt,
  };
}

/** Enable (or rotate) the public live-ticker link for the team's currently running match. */
export async function enableLiveShare(request: Request, env: Env, auth: AuthContext, clubId: string, teamId: string, requestId: string): Promise<Response> {
  requireSameOrigin(request);
  const context = await requireTeamAccess(env.DB, auth, clubId, teamId, "matches.update");
  const { token, tokenHash } = mintToken();
  const now = new Date().toISOString();
  const updated = await env.DB.prepare("UPDATE team_drafts SET share_token_hash=?,updated_at=? WHERE club_id=? AND team_id=?")
    .bind(await tokenHash, now, context.clubId, context.teamId).run();
  if (updated.meta.changes !== 1) throw new HttpError(409, "NO_LIVE_MATCH", "There is no running match to share yet.");
  await writeAudit(env.DB, { clubId: context.clubId, userId: auth.userId, action: "LIVE_SHARE_ENABLED", entityType: "team", entityId: context.teamId });
  return json({ token }, requestId);
}

export async function disableLiveShare(request: Request, env: Env, auth: AuthContext, clubId: string, teamId: string, requestId: string): Promise<Response> {
  requireSameOrigin(request);
  const context = await requireTeamAccess(env.DB, auth, clubId, teamId, "matches.update");
  await env.DB.prepare("UPDATE team_drafts SET share_token_hash=NULL WHERE club_id=? AND team_id=?").bind(context.clubId, context.teamId).run();
  await writeAudit(env.DB, { clubId: context.clubId, userId: auth.userId, action: "LIVE_SHARE_DISABLED", entityType: "team", entityId: context.teamId });
  return json({ ok: true }, requestId);
}

/** Public, unauthenticated: score + generic event log only. No player names, no free text, no ids. */
export async function getPublicLive(request: Request, env: Env, token: string, requestId: string): Promise<Response> {
  await enforceRateLimit(env.LOGIN_RATE_LIMITER, [clientIp(request), "live.view"]);
  if (typeof token !== "string" || token.length < 20 || token.length > 64) throw NOT_FOUND;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare("SELECT payload_json AS payloadJson, updated_at AS updatedAt FROM team_drafts WHERE share_token_hash=?")
    .bind(tokenHash).first<{ payloadJson: string; updatedAt: string }>();
  if (!row) throw NOT_FOUND;
  return json(publicView(row.payloadJson, row.updatedAt), requestId);
}
