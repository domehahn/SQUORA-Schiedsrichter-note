import { DFBNET_LIMITS } from "./schema";

export class DfbnetValidationError extends Error {
  constructor(readonly code: string) { super(code); }
}

export function validateFile(input: ArrayBuffer, filename: string): void {
  if (input.byteLength === 0) throw new DfbnetValidationError("EMPTY_FILE");
  if (input.byteLength > DFBNET_LIMITS.maxFileBytes) throw new DfbnetValidationError("FILE_TOO_LARGE");
  if (!filename || filename.length > DFBNET_LIMITS.maxFilenameLength) throw new DfbnetValidationError("INVALID_FILENAME");
}

export function validateTable(rows: string[][]): void {
  if (rows.length > DFBNET_LIMITS.maxRows + 1) throw new DfbnetValidationError("TOO_MANY_ROWS");
  for (const row of rows) {
    if (row.length > DFBNET_LIMITS.maxColumns) throw new DfbnetValidationError("TOO_MANY_COLUMNS");
    if (row.some((field) => field.length > DFBNET_LIMITS.maxFieldLength)) throw new DfbnetValidationError("FIELD_TOO_LONG");
  }
}

