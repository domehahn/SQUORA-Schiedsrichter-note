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

