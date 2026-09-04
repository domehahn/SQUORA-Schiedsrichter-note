import type { AuthContext } from "../auth/session";
import { sha256 } from "../auth/session";
import { HttpError, json, readJson, requireSameOrigin } from "../core/http";
import { newId } from "../core/id";
import { objectValue, stringValue } from "../core/validation";
import { requireTeamAccess } from "../middleware/tenant";
import { writeAudit } from "../services/audit-service";
import { putState } from "./state";

const LEGACY_ID = /^[A-Za-z0-9_-]{1,64}$/u;

interface LegacyMeta { id: string; name?: string; salt?: string; verifierIv?: string; verifier?: string }

function legacyPrefix(auth: AuthContext): string {
  return `note:${auth.email.toLowerCase()}`;
}

async function legacyIndex(env: Env, auth: AuthContext): Promise<LegacyMeta[]> {
  if (!env.LEGACY_DATA) return [];
  const raw = await env.LEGACY_DATA.get(`${legacyPrefix(auth)}:index`);
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as { tenants?: unknown };
    return Array.isArray(value.tenants) ? value.tenants.filter((entry): entry is LegacyMeta => Boolean(entry) && typeof entry === "object" && typeof (entry as LegacyMeta).id === "string" && LEGACY_ID.test((entry as LegacyMeta).id)) : [];
  } catch { return []; }
}

async function source(env: Env, auth: AuthContext, legacyTenantId: string): Promise<string | null> {
  if (!env.LEGACY_DATA) return null;
  if (legacyTenantId === "legacy-archive") return env.LEGACY_DATA.get(legacyPrefix(auth));
  const index = await legacyIndex(env, auth);
  if (!index.some((entry) => entry.id === legacyTenantId)) return null;
  return env.LEGACY_DATA.get(`${legacyPrefix(auth)}:t:${legacyTenantId}`);
}

export async function listLegacyTenants(env: Env, auth: AuthContext, requestId: string): Promise<Response> {
  const entries = await legacyIndex(env, auth);
  const archiveExists = Boolean(env.LEGACY_DATA && await env.LEGACY_DATA.get(legacyPrefix(auth)));
  return json({ tenants: entries.map((entry) => ({
    id: entry.id,
    name: typeof entry.name === "string" ? entry.name.slice(0, 120) : "Legacy-Verein",
    salt: typeof entry.salt === "string" ? entry.salt.slice(0, 64) : "",
    verifierIv: typeof entry.verifierIv === "string" ? entry.verifierIv.slice(0, 64) : "",
    verifier: typeof entry.verifier === "string" ? entry.verifier.slice(0, 256) : "",
  })), archiveExists }, requestId);
}

export async function readLegacyPayload(env: Env, auth: AuthContext, legacyTenantId: string, requestId: string): Promise<Response> {
  if (!LEGACY_ID.test(legacyTenantId)) throw new HttpError(404, "NOT_FOUND", "The requested resource was not found.");
  const raw = await source(env, auth, legacyTenantId);
  if (!raw) throw new HttpError(404, "NOT_FOUND", "The requested resource was not found.");
  return json({ legacyTenantId, sourceFingerprint: await sha256(raw), payload: JSON.parse(raw) }, requestId);
}

export async function migrateLegacy(request: Request, env: Env, auth: AuthContext, clubId: string, teamId: string, requestId: string): Promise<Response> {
  requireSameOrigin(request);
  const context = await requireTeamAccess(env.DB, auth, clubId, teamId, "matches.update");
  const body = objectValue(await readJson(request, 4_194_304));
  const legacyTenantId = stringValue(body, "legacyTenantId", { min: 1, max: 64 })!;
  if (!LEGACY_ID.test(legacyTenantId)) throw new HttpError(422, "VALIDATION_FAILED", "The request data is invalid.");
  const raw = await source(env, auth, legacyTenantId);
  if (!raw) throw new HttpError(404, "NOT_FOUND", "The requested resource was not found.");
  const fingerprint = await sha256(raw);
  const suppliedFingerprint = stringValue(body, "sourceFingerprint", { min: 64, max: 64 });
  if (suppliedFingerprint !== fingerprint) throw new HttpError(409, "LEGACY_SOURCE_CHANGED", "The legacy source changed and must be loaded again.");

  const existing = await env.DB.prepare("SELECT club_id AS clubId,team_id AS teamId,source_fingerprint AS fingerprint,status FROM legacy_migrations WHERE user_id=? AND legacy_tenant_id=?")
    .bind(auth.userId, legacyTenantId).first<{ clubId: string; teamId: string; fingerprint: string; status: string }>();
  if (existing) {
    if (existing.clubId !== context.clubId || existing.teamId !== context.teamId) throw new HttpError(409, "LEGACY_ALREADY_MAPPED", "This legacy tenant is already mapped to another target.");
    if (existing.status === "completed" && existing.fingerprint === fingerprint) return json({ ok: true, alreadyMigrated: true }, requestId);
  }

  const data = objectValue(body.data);
  const recordCount = (Array.isArray(data.archive) ? data.archive.length : 0) + (Array.isArray(data.tournaments) ? data.tournaments.length : 0) + (Array.isArray(data.teams) ? data.teams.length : 0);
  const migrationId = newId();
  const now = new Date().toISOString();
  if (existing) {
    await env.DB.prepare("UPDATE legacy_migrations SET source_fingerprint=?,status='started',record_count=?,completed_at=NULL,error_code=NULL WHERE user_id=? AND legacy_tenant_id=?")
      .bind(fingerprint, recordCount, auth.userId, legacyTenantId).run();
  } else {
    await env.DB.prepare(`INSERT INTO legacy_migrations (id,user_id,club_id,team_id,legacy_tenant_id,source_fingerprint,status,record_count,created_at)
      VALUES (?,?,?,?,?,?,'started',?,?)`).bind(migrationId, auth.userId, context.clubId, context.teamId, legacyTenantId, fingerprint, recordCount, now).run();
  }
  await writeAudit(env.DB, { clubId: context.clubId, userId: auth.userId, action: "LEGACY_MIGRATION_STARTED", entityType: "legacy_migration", entityId: existing ? null : migrationId, metadata: { records: recordCount } });

  try {
    const stateRequest = new Request(request.url, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: new URL(request.url).origin },
      body: JSON.stringify(data),
    });
    const response = await putState(stateRequest, env, auth, context.clubId, context.teamId, requestId);
    if (!response.ok) return response;
    const completedAt = new Date().toISOString();
    await env.DB.prepare("UPDATE legacy_migrations SET status='completed',completed_at=?,error_code=NULL WHERE user_id=? AND legacy_tenant_id=?")
      .bind(completedAt, auth.userId, legacyTenantId).run();
    await writeAudit(env.DB, { clubId: context.clubId, userId: auth.userId, action: "LEGACY_MIGRATION_COMPLETED", entityType: "legacy_migration", entityId: migrationId, metadata: { records: recordCount } });
    return json({ ok: true, alreadyMigrated: false, records: recordCount }, requestId, 201);
  } catch (error) {
    const code = error instanceof HttpError ? error.code : "MIGRATION_FAILED";
    await env.DB.prepare("UPDATE legacy_migrations SET status='failed',error_code=? WHERE user_id=? AND legacy_tenant_id=?")
      .bind(code, auth.userId, legacyTenantId).run();
    await writeAudit(env.DB, { clubId: context.clubId, userId: auth.userId, action: "LEGACY_MIGRATION_FAILED", entityType: "legacy_migration", entityId: migrationId, metadata: { code } });
    throw error;
  }
}
