import { DFBNET_LIMITS } from "./schema";
import { DfbnetValidationError, validateTable } from "./validator";

function delimiterFor(text: string): string {
  const counts = new Map([[";", 0], ["\t", 0], [",", 0]]);
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && (char === "\n" || char === "\r")) break;
    else if (!quoted && counts.has(char)) counts.set(char, counts.get(char)! + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0][1] > 0 ? [...counts].sort((a, b) => b[1] - a[1])[0][0] : ";";
}

export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/u, "");
  const delimiter = delimiterFor(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const started = performance.now();
  const pushField = () => { row.push(field.trim()); field = ""; };
  const pushRow = () => {
    pushField();
    if (row.some((cell) => cell.length > 0)) rows.push(row);
    row = [];
    if (rows.length > DFBNET_LIMITS.maxRows + 1) throw new DfbnetValidationError("TOO_MANY_ROWS");
  };
  for (let index = 0; index < text.length; index += 1) {
    if (index % 8192 === 0 && performance.now() - started > DFBNET_LIMITS.maxParseMilliseconds) throw new DfbnetValidationError("PARSE_TIMEOUT");
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field.length === 0) quoted = true;
    else if (char === delimiter) pushField();
    else if (char === "\n") pushRow();
    else if (char === "\r") {
      if (text[index + 1] === "\n") index += 1;
      pushRow();
    } else field += char;
    if (field.length > DFBNET_LIMITS.maxFieldLength) throw new DfbnetValidationError("FIELD_TOO_LONG");
    if (row.length >= DFBNET_LIMITS.maxColumns) throw new DfbnetValidationError("TOO_MANY_COLUMNS");
  }
  if (quoted) throw new DfbnetValidationError("UNCLOSED_QUOTE");
  if (field.length || row.length) pushRow();
  validateTable(rows);
  return rows;
}

