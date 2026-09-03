import { detectSchema } from "./schema";
import type { ExternalPlayer, ExternalRoster } from "./types";

const GENDER_RE = /\s*\([mwd](?:\/[mwd])?\)\s*/gi;
// eslint-disable-next-line no-control-regex -- untrusted CSV input: strip C0/C1 control characters
const CONTROL_RE = /[\u0000-\u001f\u007f]/g;
const clean = (value: string | undefined, max = 120): string =>
  (value ?? "").replace(GENDER_RE, " ").replace(CONTROL_RE, " ").replace(/\s{2,}/g, " ").trim().slice(0, max);

export function teamNameFromFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "");
  return base.replace(/[-_ ]?\d{4}-?\d{2}-?\d{2}$/, "").replace(/[-_ ]?\d{6,8}$/, "").replace(/_+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 120);
}

export function mapRoster(rows: string[][], filename: string): ExternalRoster {
  if (rows.length === 0) return { provider: "dfbnet_csv", teamName: teamNameFromFilename(filename), players: [], warnings: [] };
  const schema = detectSchema(rows[0]);
  const data = schema.hasHeader ? rows.slice(1) : rows;
  const seen = new Set<string>();
  const players: ExternalPlayer[] = [];
  for (const cells of data) {
    const firstName = clean(cells[schema.firstName]);
    const lastName = clean(cells[schema.lastName]);
    const name = clean([firstName, lastName].filter(Boolean).join(" "));
    const shirtNumber = schema.shirtNumber >= 0 ? clean(cells[schema.shirtNumber], 8).replace(/[^0-9A-Za-z-]/g, "") : "";
    const externalId = schema.externalId >= 0 ? clean(cells[schema.externalId], 120) : "";
    const pass = schema.pass >= 0 ? clean(cells[schema.pass], 30) : "";
    const birthdate = schema.birthdate >= 0 ? clean(cells[schema.birthdate], 12) : "";
    if (!name) continue;
    const key = `${externalId}|${name.toLocaleLowerCase("de")}|${shirtNumber}`;
    if (seen.has(key)) continue;
    seen.add(key);
    players.push({
      ...(externalId ? { externalId } : {}),
      firstName,
      lastName,
      name,
      shirtNumber,
      ...(pass ? { pass } : {}),
      ...(birthdate ? { birthdate } : {}),
    });
  }
  return { provider: "dfbnet_csv", teamName: teamNameFromFilename(filename), players, warnings: schema.hasHeader ? [] : ["HEADER_NOT_DETECTED"] };
}
