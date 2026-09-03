/** Fields the domain model + server persistence accept. The server whitelist in cloudflare/api/state.ts is authoritative. */
export const ALLOWED_DFBNET_FIELDS = ["name", "firstName", "shirtNumber", "externalId"] as const;

/** Optional identity-verification aids kept only in the encrypted client cache, never sent to the server. */
export const LOCAL_ONLY_DFBNET_FIELDS = ["pass", "birthdate"] as const;

export const DFBNET_LIMITS = {
  maxFileBytes: 2 * 1024 * 1024,
  maxRows: 5000,
  maxColumns: 100,
  maxFieldLength: 2000,
  maxFilenameLength: 255,
  maxParseMilliseconds: 1500,
} as const;

export interface DetectedSchema {
  firstName: number;
  lastName: number;
  shirtNumber: number;
  externalId: number;
  pass: number;
  birthdate: number;
  hasHeader: boolean;
}

function normalized(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function column(header: string[], names: string[]): number {
  const normalizedHeader = header.map(normalized);
  return normalizedHeader.findIndex((cell) => names.some((name) => cell === name || cell.startsWith(`${name} `)));
}

export function detectSchema(firstRow: string[]): DetectedSchema {
  const firstName = column(firstRow, ["vorname rufname", "vorname", "rufname", "first name"]);
  const lastName = column(firstRow, ["name kunstlername", "nachname", "name", "spieler", "last name"]);
  const shirtNumber = column(firstRow, ["rnr", "ruckennummer", "trikotnummer", "trikot", "nummer", "nr"]);
  const externalId = column(firstRow, ["dfbnet id", "spieler id", "player id", "external id"]);
  const pass = column(firstRow, ["passnummer", "pass nr", "passnr", "pass"]);
  const birthdate = column(firstRow, ["geb", "geburtsdatum", "geburtstag", "birthdate", "date of birth"]);
  const hasHeader = firstName >= 0 || lastName >= 0 || shirtNumber >= 0 || externalId >= 0 || pass >= 0 || birthdate >= 0;
  return { firstName: hasHeader ? firstName : 1, lastName: hasHeader ? lastName : 0, shirtNumber, externalId, pass, birthdate, hasHeader };
}

