import { ageGroups, score, type SavedMatch } from "./match";

export interface SeasonStats {
  matches: number;
  goals: number;
  yellow: number;
  yellowRed: number;
  red: number;
  timePenalties: number;
  substitutions: number;
  abandoned: number;
  byAge: { label: string; matches: number }[];
}

function inRange(dateIso: string, fromIso: string, toIso: string): boolean {
  return dateIso >= fromIso && dateIso <= toIso;
}

function matchDate(entry: SavedMatch): string {
  return entry.state.matchDate || (entry.state.startedAt ?? entry.savedAt).slice(0, 10);
}

export function filterArchive(archive: SavedMatch[], fromIso: string, toIso: string): SavedMatch[] {
  return archive.filter((entry) => inRange(matchDate(entry), fromIso, toIso));
}

export function seasonStats(archive: SavedMatch[], fromIso: string, toIso: string): SeasonStats {
  const rows = filterArchive(archive, fromIso, toIso);
  const stats: SeasonStats = {
    matches: rows.length,
    goals: 0,
    yellow: 0,
    yellowRed: 0,
    red: 0,
    timePenalties: 0,
    substitutions: 0,
    abandoned: 0,
    byAge: [],
  };
  const ageCount = new Map<string, number>();
  for (const entry of rows) {
    const state = entry.state;
    stats.goals += score(state.events, "home") + score(state.events, "away");
    if (state.phase === "abandoned") stats.abandoned += 1;
    for (const event of state.events) {
      if (event.kind === "yellow") stats.yellow += 1;
      else if (event.kind === "yellowRed") stats.yellowRed += 1;
      else if (event.kind === "red") stats.red += 1;
      else if (event.kind === "timePenalty") stats.timePenalties += 1;
      else if (event.kind === "substitution") stats.substitutions += 1;
    }
    ageCount.set(state.ageGroup, (ageCount.get(state.ageGroup) ?? 0) + 1);
  }
  stats.byAge = [...ageCount.entries()]
    .map(([value, matches]) => ({ label: ageGroups.find((group) => group.value === value)?.label ?? value, matches }))
    .sort((a, b) => b.matches - a.matches);
  return stats;
}

export function statsCsvRows(archive: SavedMatch[], fromIso: string, toIso: string): string[][] {
  const header = ["Datum", "Begegnung", "Ergebnis", "Jugend", "Status", "Gelb", "Gelb-Rot", "Rot", "Zeitstrafen", "Wechsel"];
  const rows = filterArchive(archive, fromIso, toIso)
    .slice()
    .sort((a, b) => matchDate(a).localeCompare(matchDate(b)))
    .map((entry) => {
      const state = entry.state;
      const count = (kind: string) => state.events.filter((event) => event.kind === kind).length;
      return [
        matchDate(entry),
        `${state.homeTeam} – ${state.awayTeam}`,
        `${score(state.events, "home")}:${score(state.events, "away")}`,
        ageGroups.find((group) => group.value === state.ageGroup)?.label ?? state.ageGroup,
        state.phase === "abandoned" ? "Abbruch" : "regulär",
        String(count("yellow")),
        String(count("yellowRed")),
        String(count("red")),
        String(count("timePenalty")),
        String(count("substitution")),
      ];
    });
  return [header, ...rows];
}
