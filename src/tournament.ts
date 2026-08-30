import { score, uid, type SavedMatch } from "./match";

export interface Fixture {
  id: string;
  group: string;
  home: string;
  away: string;
  kickoff: string;
  matchId: string | null;
}

export interface Tournament {
  id: string;
  name: string;
  date: string;
  ageGroup: string;
  halfDurationMinutes: number;
  groups: string[];
  fixtures: Fixture[];
  archived: boolean;
  updatedAt: string;
}

export interface StandingRow {
  team: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
}

export function createTournament(name = "", date: string): Tournament {
  return {
    id: uid(),
    name,
    date,
    ageGroup: "D",
    halfDurationMinutes: 30,
    groups: ["A"],
    fixtures: [],
    archived: false,
    updatedAt: new Date().toISOString(),
  };
}

export function createFixture(group: string): Fixture {
  return { id: uid(), group, home: "", away: "", kickoff: "", matchId: null };
}

export function sanitizeTournament(value: unknown): Tournament | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<Tournament> & Record<string, unknown>;
  if (typeof source.id !== "string" || !source.id) return null;
  const groups = Array.isArray(source.groups) && source.groups.length
    ? source.groups.filter((group): group is string => typeof group === "string")
    : ["A"];
  const fixtures = Array.isArray(source.fixtures)
    ? source.fixtures
        .filter((fixture): fixture is Fixture => Boolean(fixture) && typeof fixture === "object")
        .map((fixture) => ({
          id: typeof fixture.id === "string" && fixture.id ? fixture.id : uid(),
          group: typeof fixture.group === "string" ? fixture.group : groups[0],
          home: String(fixture.home ?? ""),
          away: String(fixture.away ?? ""),
          kickoff: String(fixture.kickoff ?? ""),
          matchId: typeof fixture.matchId === "string" ? fixture.matchId : null,
        }))
    : [];
  return {
    id: source.id,
    name: String(source.name ?? ""),
    date: String(source.date ?? ""),
    ageGroup: String(source.ageGroup ?? "D"),
    halfDurationMinutes: Number(source.halfDurationMinutes) || 30,
    groups,
    fixtures,
    archived: source.archived === true,
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : new Date().toISOString(),
  };
}

export function sanitizeTournaments(value: unknown): Tournament[] {
  if (!Array.isArray(value)) return [];
  return value.map(sanitizeTournament).filter((tournament): tournament is Tournament => tournament !== null);
}

export function mergeTournaments(...lists: Tournament[][]): Tournament[] {
  const byId = new Map<string, Tournament>();
  for (const tournament of lists.flat()) {
    const current = byId.get(tournament.id);
    if (!current || tournament.updatedAt > current.updatedAt) byId.set(tournament.id, tournament);
  }
  return [...byId.values()].sort((a, b) => (b.date + b.updatedAt).localeCompare(a.date + a.updatedAt));
}

interface Tally extends StandingRow {}

function ensureRow(map: Map<string, Tally>, team: string): Tally {
  const key = team.trim() || "—";
  let row = map.get(key);
  if (!row) {
    row = { team: key, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDiff: 0, points: 0 };
    map.set(key, row);
  }
  return row;
}

export function standings(tournament: Tournament, archive: SavedMatch[], group?: string): StandingRow[] {
  const rows = new Map<string, Tally>();
  const byId = new Map(archive.map((entry) => [entry.state.id, entry]));

  for (const fixture of tournament.fixtures) {
    if (group && fixture.group !== group) continue;
    if (fixture.home) ensureRow(rows, fixture.home);
    if (fixture.away) ensureRow(rows, fixture.away);
    if (!fixture.matchId) continue;
    const match = byId.get(fixture.matchId)?.state;
    if (!match || match.phase !== "finished") continue;

    const homeGoals = score(match.events, "home");
    const awayGoals = score(match.events, "away");
    const home = ensureRow(rows, fixture.home || match.homeTeam);
    const away = ensureRow(rows, fixture.away || match.awayTeam);

    home.played += 1;
    away.played += 1;
    home.goalsFor += homeGoals;
    home.goalsAgainst += awayGoals;
    away.goalsFor += awayGoals;
    away.goalsAgainst += homeGoals;

    if (homeGoals > awayGoals) {
      home.won += 1;
      home.points += 3;
      away.lost += 1;
    } else if (homeGoals < awayGoals) {
      away.won += 1;
      away.points += 3;
      home.lost += 1;
    } else {
      home.drawn += 1;
      away.drawn += 1;
      home.points += 1;
      away.points += 1;
    }
  }

  return [...rows.values()]
    .map((row) => ({ ...row, goalDiff: row.goalsFor - row.goalsAgainst }))
    .sort((a, b) => b.points - a.points || b.goalDiff - a.goalDiff || b.goalsFor - a.goalsFor || a.team.localeCompare(b.team));
}
