// Secrets are not part of the generated wrangler types. Declared here so the
// Worker can read them type-safely; set with `wrangler secret put`.
interface Env {
  /** Optional Slack-compatible incoming webhook for scheduled self-check alerts. */
  ALERT_WEBHOOK_URL?: string;
}
