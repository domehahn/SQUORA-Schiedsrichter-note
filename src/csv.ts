/** Leading characters a spreadsheet may interpret as a formula (CSV / formula injection). */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/** Quotes a value for CSV and neutralises spreadsheet formula injection (OWASP). */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

/** Serialises rows to a UTF-8-BOM CSV string with CRLF line endings. */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<unknown>>, delimiter = ";"): string {
  return `﻿${rows.map((row) => row.map(csvCell).join(delimiter)).join("\r\n")}`;
}
