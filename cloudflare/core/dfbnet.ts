import { HttpError } from "./http";

/**
 * Fields allowed to enter the domain model from an external roster source.
 * Mirrors `src/integrations/dfbnet/schema.ts`; this server copy is authoritative.
 */
export const ALLOWED_DFBNET_FIELDS = ["name", "firstName", "shirtNumber", "externalId"] as const;

/**
 * Sensitive keys stripped from any synced payload at every nesting depth, even
 * if a client sends them. Defence in depth behind the client whitelist.
 */
export const FORBIDDEN_DFBNET_FIELDS = new Set([
  "birthdate", "birth_date", "geburtsdatum", "pass", "passnumber", "passnummer",
  "nationality", "nationalität", "eligibility", "spielrecht", "registrationdate",
]);

export function minimize(value: unknown, depth = 0): unknown {
  if (depth > 20) throw new HttpError(422, "VALIDATION_FAILED", "The request data is invalid.");
  if (Array.isArray(value)) return value.map((entry) => minimize(entry, depth + 1));
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (!FORBIDDEN_DFBNET_FIELDS.has(key.toLowerCase())) result[key] = minimize(child, depth + 1);
  }
  return result;
}
