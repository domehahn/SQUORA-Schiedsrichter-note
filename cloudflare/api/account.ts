import type { AuthContext } from "../auth/session";
import { expiredSessionCookie, revokeAllSessions } from "../auth/session";
import { HttpError, json, readJson, requireSameOrigin } from "../core/http";
import { parseBody } from "../core/validation";
import { purgeClub } from "../services/club-deletion";
import { writeAudit } from "../services/audit-service";

const CONFIRM_PHRASE = "KONTO LÖSCHEN";

/**
 * Deletes the caller's own account. The user row is not dropped — it is turned
 * into a tombstone (anonymised e-mail/name, `status='deleted'`) so audit and
 * import references stay valid; `optionalAuth` already blocks a non-active user.
 * Clubs the user solely owns are only removed when no other active member
 * remains; otherwise the caller must transfer ownership first.
 */
export async function deleteAccount(request: Request, env: Env, auth: AuthContext, requestId: string): Promise<Response> {
  requireSameOrigin(request);
  const body = parseBody(await readJson(request, 4096), { confirm: { kind: "string", max: 40 } });
  if (body.confirm !== CONFIRM_PHRASE) {
    throw new HttpError(422, "CONFIRMATION_MISMATCH", "The confirmation phrase does not match.");
  }

  const ownedClubs = await env.DB.prepare(
    "SELECT club_id AS clubId FROM memberships WHERE user_id=? AND role='club_owner' AND status='active'",
  ).bind(auth.userId).all<{ clubId: string }>();

  const blocked: string[] = [];
  const purgeable: string[] = [];
  for (const { clubId } of ownedClubs.results) {
    const others = await env.DB.prepare(
      "SELECT count(*) AS n FROM memberships WHERE club_id=? AND user_id<>? AND status='active'",
    ).bind(clubId, auth.userId).first<{ n: number }>();
    if ((others?.n ?? 0) > 0) blocked.push(clubId);
    else purgeable.push(clubId);
  }
  if (blocked.length > 0) {
    throw new HttpError(409, "OWNER_TRANSFER_REQUIRED", "Transfer ownership or delete these clubs before deleting the account.");
  }

  for (const clubId of purgeable) {
    await writeAudit(env.DB, { clubId, userId: auth.userId, action: "CLUB_DELETED", entityType: "club", entityId: clubId, metadata: { clubId, reason: "owner_account_deleted" } });
    await purgeClub(env.DB, clubId);
  }

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM memberships WHERE user_id=?").bind(auth.userId),
    env.DB.prepare("UPDATE users SET email=?,display_name='Gelöschtes Konto',status='deleted',updated_at=? WHERE id=?")
      .bind(`deleted-${auth.userId}@deleted.invalid`, now, auth.userId),
  ]);
  await revokeAllSessions(env.DB, auth.userId);
  await writeAudit(env.DB, { userId: auth.userId, action: "USER_DELETED", entityType: "user", entityId: auth.userId, metadata: { purgedClubs: purgeable.length } });

  const response = json({ ok: true, purgedClubs: purgeable.length }, requestId);
  response.headers.set("Set-Cookie", expiredSessionCookie());
  return response;
}
