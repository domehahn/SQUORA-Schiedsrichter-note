import { uid, type Player } from "./match";

export interface DfbnetImport {
  players: Player[];
  teamName: string;
}

const GENDER_RE = /\s*\([mwd](?:\/[mwd])?\)\s*/gi;

function clean(value: string | undefined): string {
  return (value ?? "").replace(GENDER_RE, " ").replace(/\s{2,}/g, " ").trim();
}

function detectDelimiter(line: string): string {
  if (line.includes(";")) return ";";
  if (line.includes("\t")) return "\t";
  return ",";
}

function findColumn(header: string[], candidates: string[]): number {
  for (const candidate of candidates) {
    const index = header.findIndex((cell) => cell === candidate || cell.startsWith(candidate));
    if (index >= 0) return index;
  }
  return -1;
}

export function teamNameFromFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "");
  const withoutDate = base
    .replace(/[-_ ]?\d{4}-?\d{2}-?\d{2}$/, "")
    .replace(/[-_ ]?\d{6,8}$/, "");
  return withoutDate.replace(/[_]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

/** Parses a DFBnet team/roster CSV export (";"-separated, "Name / Vorname / Geb. / …"). */
export function parseDfbnetRoster(csv: string, filename = ""): DfbnetImport {
  const teamName = teamNameFromFilename(filename);
  const lines = csv
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return { players: [], teamName };

  const delimiter = detectDelimiter(lines[0]);
  const firstCells = lines[0].split(delimiter).map((cell) => cell.toLowerCase().trim());
  const hasHeader = firstCells.some((cell) => cell.includes("name") || cell.includes("vorname") || cell.includes("geb"));
  const header = hasHeader ? firstCells : [];
  const rows = hasHeader ? lines.slice(1) : lines;

  const lastIndex = findColumn(header, ["name künstlername", "name", "nachname", "spieler"]);
  const firstIndex = findColumn(header, ["vorname rufname", "vorname", "rufname"]);
  const numberIndex = findColumn(header, ["rnr", "rückennummer", "trikot", "nr.", "nr", "nummer"]);
  const passIndex = findColumn(header, ["passnummer", "pass-nr", "passnr", "pass"]);
  const birthIndex = findColumn(header, ["geb.", "geb", "geburtsdatum", "geburtstag"]);

  const seen = new Set<string>();
  const players: Player[] = [];
  for (const row of rows) {
    const cells = row.split(delimiter).map((cell) => cell.trim());
    if (cells.length < 2) continue;
    const last = clean(cells[lastIndex >= 0 ? lastIndex : 0]);
    const first = clean(cells[firstIndex >= 0 ? firstIndex : 1]);
    const number = numberIndex >= 0 ? (cells[numberIndex] ?? "").replace(/[^0-9A-Za-z]/g, "").slice(0, 4) : "";
    const pass = passIndex >= 0 ? (cells[passIndex] ?? "").trim().slice(0, 30) : "";
    const birthdate = birthIndex >= 0 ? (cells[birthIndex] ?? "").trim().slice(0, 12) : "";
    const name = [first, last].filter(Boolean).join(" ").trim().slice(0, 60);
    if (!name && !number && !pass) continue;
    const key = `${pass || number}|${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    players.push({ id: uid(), number, name, pass, birthdate });
  }
  return { players, teamName };
}
