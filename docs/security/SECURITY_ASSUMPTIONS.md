# Security assumptions

- Cloudflare DNS/TLS and the configured account remain controlled and protected
  with strong administrator authentication.
- D1 production is configured in the required EU jurisdiction and production,
  staging and development never share data, bindings or secrets.
- The browser and device can be compromised; local encryption reduces exposure
  but cannot protect data while the user has unlocked it.
- Client-side E2E encryption is reserved for private notes. Authoritative SaaS
  entities use D1, server-side authorization and platform encryption at rest.
- No official automated DFBnet interface is assumed. CSV input is adversarial and
  only explicitly whitelisted fields may enter the domain model.
- Logs, analytics and audit metadata exclude credentials, tokens, encryption
  material, original CSV content and full personal payloads.
- Operational readiness requires tested restore and rollback procedures; merely
  documenting them is not evidence that they work.

