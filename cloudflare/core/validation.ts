import { HttpError } from "./http";

export function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(422, "VALIDATION_FAILED", "The request data is invalid.");
  return value as Record<string, unknown>;
}

export function stringValue(source: Record<string, unknown>, key: string, options: { min?: number; max: number; optional?: boolean } ): string | undefined {
  const value = source[key];
  if (value === undefined && options.optional) return undefined;
  if (typeof value !== "string") throw new HttpError(422, "VALIDATION_FAILED", "The request data is invalid.");
  const normalized = value.trim();
  if (normalized.length < (options.min ?? 0) || normalized.length > options.max) throw new HttpError(422, "VALIDATION_FAILED", "The request data is invalid.");
  return normalized;
}

export function integerValue(source: Record<string, unknown>, key: string, options: { min: number; max: number }): number {
  const value = source[key];
  if (!Number.isInteger(value) || (value as number) < options.min || (value as number) > options.max) throw new HttpError(422, "VALIDATION_FAILED", "The request data is invalid.");
  return value as number;
}

export function boundedJson(value: unknown, maxBytes: number): string {
  const encoded = JSON.stringify(value ?? {});
  if (new TextEncoder().encode(encoded).byteLength > maxBytes) throw new HttpError(422, "VALIDATION_FAILED", "The request data is invalid.");
  return encoded;
}

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type Rule =
  | { kind: "string"; min?: number; max: number; optional?: boolean; enum?: readonly string[] }
  | { kind: "id"; optional?: boolean }
  | { kind: "int"; min: number; max: number; optional?: boolean }
  | { kind: "bool"; optional?: boolean };

/**
 * Declarative body validator shared across endpoints. Every key must be declared;
 * an undeclared key is rejected (422 UNKNOWN_FIELD) rather than silently ignored.
 * Strings are trimmed. Returns a plain record — narrow at the call site.
 */
export function parseBody(value: unknown, spec: Record<string, Rule>): Record<string, unknown> {
  const source = objectValue(value);
  for (const key of Object.keys(source)) {
    if (!Object.hasOwn(spec, key)) throw new HttpError(422, "UNKNOWN_FIELD", "The request contains an unexpected field.");
  }
  const out: Record<string, unknown> = {};
  for (const [key, rule] of Object.entries(spec)) {
    const raw = source[key];
    if (raw === undefined || raw === null) {
      if (!("optional" in rule && rule.optional)) throw new HttpError(422, "VALIDATION_FAILED", "A required field is missing.");
      continue;
    }
    if (rule.kind === "string" || rule.kind === "id") {
      if (typeof raw !== "string") throw new HttpError(422, "VALIDATION_FAILED", "The request data is invalid.");
      const text = raw.trim();
      if (rule.kind === "id") {
        if (!ID_RE.test(text)) throw new HttpError(422, "VALIDATION_FAILED", "The request data is invalid.");
      } else {
        if (text.length < (rule.min ?? 0) || text.length > rule.max) throw new HttpError(422, "VALIDATION_FAILED", "The request data is invalid.");
        if (rule.enum && !rule.enum.includes(text)) throw new HttpError(422, "VALIDATION_FAILED", "The request data is invalid.");
      }
      out[key] = text;
    } else if (rule.kind === "int") {
      if (!Number.isInteger(raw) || (raw as number) < rule.min || (raw as number) > rule.max) throw new HttpError(422, "VALIDATION_FAILED", "The request data is invalid.");
      out[key] = raw;
    } else {
      if (typeof raw !== "boolean") throw new HttpError(422, "VALIDATION_FAILED", "The request data is invalid.");
      out[key] = raw;
    }
  }
  return out;
}

