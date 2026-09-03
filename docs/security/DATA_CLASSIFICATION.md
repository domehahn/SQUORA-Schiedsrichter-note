# Data classification

| Data | Class | Handling |
| --- | --- | --- |
| Public marketing text | PUBLIC | Public cache allowed |
| Club name | INTERNAL | Active members only; audit changes |
| Match metadata/events and referee name | PERSONAL | Tenant-scoped; retention and export controls |
| Player name | PERSONAL | Minimum necessary; tenant-scoped |
| Birth date, pass number, nationality, eligibility | SENSITIVE_PERSONAL | Do not persist without approved documented purpose |
| Incident/private referee notes | SENSITIVE_PERSONAL | Optional client-side E2E encryption |
| DFBnet upload | SENSITIVE_PERSONAL | Process transiently; never log/store original CSV |
| Audit log | INTERNAL | Restricted permission; metadata minimized |
| Login credentials | SECRET | Salted password hash only; never log |
| Session token | SECRET | HttpOnly cookie; SHA-256 hash only in D1 |
| Encryption/passphrase keys | SECRET | Browser memory only; never persist or log |

Any new field requires purpose, audience, retention, necessity and
anonymization review before implementation, especially for minors.

