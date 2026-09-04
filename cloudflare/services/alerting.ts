const WINDOW_MINUTES = 60;
const THRESHOLDS = { loginFailed: 25, loginRateLimited: 5, importFailed: 3 };

/**
 * Cheap self-check from the audit trail. If a threshold is crossed in the last
 * hour and `ALERT_WEBHOOK_URL` is configured, POST a one-line summary to it
 * (Slack-compatible `{ text }`). No-op when the secret is unset.
 */
export async function checkAndAlert(env: Env, now: Date = new Date()): Promise<string[]> {
  const webhook = env.ALERT_WEBHOOK_URL;
  if (!webhook) return [];
  const since = new Date(now.getTime() - WINDOW_MINUTES * 60_000).toISOString();
  const row = await env.DB.prepare(
    "SELECT " +
    "COALESCE(SUM(action='LOGIN_FAILED'),0) AS loginFailed, " +
    "COALESCE(SUM(action='LOGIN_RATE_LIMITED'),0) AS loginRateLimited, " +
    "COALESCE(SUM(action='DFBNET_IMPORT_FAILED'),0) AS importFailed " +
    "FROM audit_log WHERE created_at >= ?",
  ).bind(since).first<{ loginFailed: number; loginRateLimited: number; importFailed: number }>();

  const alerts: string[] = [];
  if ((row?.loginFailed ?? 0) >= THRESHOLDS.loginFailed) alerts.push(`${row!.loginFailed} failed logins in ${WINDOW_MINUTES}m`);
  if ((row?.loginRateLimited ?? 0) >= THRESHOLDS.loginRateLimited) alerts.push(`${row!.loginRateLimited} login rate-limit hits in ${WINDOW_MINUTES}m`);
  if ((row?.importFailed ?? 0) >= THRESHOLDS.importFailed) alerts.push(`${row!.importFailed} DFBnet import failures in ${WINDOW_MINUTES}m`);
  if (alerts.length === 0) return [];

  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `SQUORA Schiedsrichter Note alert — ${alerts.join("; ")}` }),
    });
  } catch {
    /* alerting must never break the scheduled run */
  }
  return alerts;
}
