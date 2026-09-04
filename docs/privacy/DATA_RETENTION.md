# Data retention

Principles: store the minimum necessary, for the shortest time that serves a
stated purpose, and document every exception. Special care for data concerning
minors (see `DFBNET_DATA_HANDLING.md`).

| Data | Retention | Trigger to delete |
| --- | --- | --- |
| Account (`users`) | While the account is active | Deletion request or 24 months after `status='disabled'` |
| Membership (`memberships`) | While active | Removal from the club; cascades access loss immediately |
| Club (`clubs`) and all club-scoped data | While the club is active | Club deletion request → hard delete after a 30-day grace window |
| Matches / match events / tournaments | Current season + 2 prior seasons | Rolling season cleanup job, or club deletion |
| `team_drafts` (live match + clock) | Until the match is saved or discarded | Overwritten on next sync; cleared on team deletion |
| `team_rosters` (opponent library) | Until the member edits or clears it | Member action; club deletion |
| DFBnet upload file content | Not retained | Held in memory only during parse/preview |
| `dfbnet_imports` (metadata: filename, fingerprint, counts, status) | 12 months | Rolling cleanup |
| Private referee notes (ciphertext) | Same as the parent match | Match deletion; unreadable without the passphrase regardless |
| `sessions` | `expires_at` (8 h) or on revoke | Expired rows purged by a rolling job |
| `audit_log` | 24 months | Rolling cleanup; never contains secrets or full personal payloads |
| Structured request logs | Per Cloudflare Logs/Logpush config, ≤ 30 days | Platform retention |
| Encrypted IndexedDB cache (browser) | Until lock / logout / passphrase change | `deleteEncryptedCache`; also cleared by the browser |

## Implementation status

A daily cron (`triggers.crons` → `worker.ts` `scheduled` → `services/retention.ts`)
purges expired/revoked `sessions`, trims `audit_log` beyond 24 months and
`dfbnet_imports` beyond 12 months, and hard-deletes clubs whose 30-day deletion
grace window has elapsed (`runClubPurge`). The whole-team sync (`putState`)
sheds archived matches older than the current + 2 prior seasons from the server
DB; they remain in the recording device's local archive. Still policy-only: the
weekly encrypted logical export — tracked in `docs/PRODUCTION_READINESS.md`.
Request-based deletion is in `DATA_DELETION.md`.
