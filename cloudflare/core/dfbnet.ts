import { HttpError } from "./http";

/**
 * Fields allowed to enter the domain model from an external roster source.
 * Mirrors `src/integrations/dfbnet/schema.ts`; this server copy is authoritative.
 * `passNumber` and `birthdate` are accepted only on the referee's own-team
 * relational roster import (`api/dfbnet.ts`), never in the `/state` sync blob.
 */
export const ALLOWED_DFBNET_FIELDS = ["name", "firstName", "shirtNumber", "externalId", "passNumber", "birthdate"] as const;

/**
 * Club-external attributes that are never persisted, at any nesting depth, on
 * any path. Defence in depth behind the client whitelist.
 */
const EXTERNAL_ATTRIBUTES = [
  "nationality", "nationalität", "eligibility", "spielrecht", "registrationdate",
];

/**
 * Stripped from the `/state` synchronisation blob (matches, events, tournaments,
 * roster library, live draft). The pass number is retained here — it belongs on
 * the referee's match sheet (product decision 2026-09-04) — but the birthdate is
 * not: it only ever lives on the `players` table.
 */
export const FORBIDDEN_DFBNET_FIELDS = new Set([
  ...EXTERNAL_ATTRIBUTES,
  "birthdate", "birth_date", "geburtsdatum",
]);

/**
 * Stripped from the staged own-team roster import. The relational `players` row
 * keeps the pass number and birthdate for the passport / eligibility check
 * (documented in `docs/privacy/DFBNET_DATA_HANDLING.md`); only club-external
 * attributes are removed.
 */
export const ROSTER_IMPORT_FORBIDDEN_DFBNET_FIELDS = new Set(EXTERNAL_ATTRIBUTES);

export function minimize(value: unknown, forbidden: Set<string> = FORBIDDEN_DFBNET_FIELDS, depth = 0): unknown {
  if (depth > 20) throw new HttpError(422, "VALIDATION_FAILED", "The request data is invalid.");
  if (Array.isArray(value)) return value.map((entry) => minimize(entry, forbidden, depth + 1));
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (!forbidden.has(key.toLowerCase())) result[key] = minimize(child, forbidden, depth + 1);
  }
  return result;
}
