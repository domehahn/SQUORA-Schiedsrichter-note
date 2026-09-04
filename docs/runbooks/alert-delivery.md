# Runbook — alert channel delivery

The daily `scheduled` handler runs `services/alerting.ts`: it counts
`LOGIN_FAILED` (≥ 25), `LOGIN_RATE_LIMITED` (≥ 5) and `DFBNET_IMPORT_FAILED`
(≥ 3) in the last 60 minutes and, if any threshold is crossed **and**
`ALERT_WEBHOOK_URL` is set, `POST`s `{ text }` to it. No secret → silent no-op.

## Configure

```sh
wrangler secret put ALERT_WEBHOOK_URL --env production
# paste a Slack (or Slack-compatible) incoming webhook URL
```

- The URL is a secret: never commit it, never log it, never put it in an issue.
- `env.d.ts` types it optional; code already guards `if (!env.ALERT_WEBHOOK_URL)`.

## Verify delivery safely (synthetic)

Do **not** trigger real failed logins on a real account. Instead seed synthetic
audit rows in a **staging** DB, then invoke the scheduled handler.

```sh
# 1. seed >25 synthetic LOGIN_FAILED rows in the last hour (staging DB)
wrangler d1 execute schiedsrichter-note-staging --env staging --remote --command \
  "WITH RECURSIVE c(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM c WHERE i<30) \
   INSERT INTO audit_log (id,action,entity_type,created_at) \
   SELECT lower(hex(randomblob(16))),'LOGIN_FAILED','session',datetime('now') FROM c;"

# 2. fire the cron handler once
wrangler dev --env staging --test-scheduled --local=false
#   then: curl -s 'http://localhost:8787/__scheduled?cron=17+3+*+*+*'
#   (or trigger from the Cloudflare dashboard: Workers > cron > Run)

# 3. confirm the message arrived in the Slack channel
# 4. clean up
wrangler d1 execute schiedsrichter-note-staging --env staging --remote --command \
  "DELETE FROM audit_log WHERE action='LOGIN_FAILED';"
```

Record the date, the channel and a screenshot-free confirmation in the release
notes. Only then may `PRODUCTION_READINESS.md` move observability to green.

## Failure modes

| Symptom | Cause | Fix |
| --- | --- | --- |
| No message, thresholds clearly crossed | secret unset | `wrangler secret put ALERT_WEBHOOK_URL` |
| `console.error … SCHEDULED_FAILED` in tail | webhook 4xx/5xx or network | check the webhook URL is current; Slack rotates them |
| Message every day | a real attack **or** a stuck synthetic row | inspect `audit_log`; if synthetic, delete it |
