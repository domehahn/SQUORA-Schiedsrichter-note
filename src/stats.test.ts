import { describe, expect, it } from "vitest";
import { createMatch, type MatchEvent, type SavedMatch } from "./match";
import { seasonStats } from "./stats";

function evt(kind: MatchEvent["kind"], team: "home" | "away" = "home"): MatchEvent {
  return { id: Math.random().toString(36).slice(2), kind, team, matchMs: 0, exactTime: "00:00", minute: 0, label: kind, createdAt: "x" };
}

const archive: SavedMatch[] = [
  { savedAt: "x", state: createMatch({ id: "m1", matchDate: "2026-08-15", ageGroup: "D", events: [evt("goal"), evt("goal", "away"), evt("yellow"), evt("substitution")] }) },
  { savedAt: "x", state: createMatch({ id: "m2", matchDate: "2026-09-01", ageGroup: "E", phase: "abandoned", events: [evt("red"), evt("timePenalty")] }) },
  { savedAt: "x", state: createMatch({ id: "m3", matchDate: "2027-08-01", ageGroup: "D", events: [evt("goal")] }) },
];

describe("seasonStats", () => {
  it("aggregiert nur Spiele im Zeitraum", () => {
    const stats = seasonStats(archive, "2026-07-01", "2027-06-30");
    expect(stats.matches).toBe(2);
    expect(stats.goals).toBe(2);
    expect(stats.yellow).toBe(1);
    expect(stats.red).toBe(1);
    expect(stats.timePenalties).toBe(1);
    expect(stats.substitutions).toBe(1);
    expect(stats.abandoned).toBe(1);
    expect(stats.byAge.reduce((sum, row) => sum + row.matches, 0)).toBe(2);
  });

  it("schließt Spiele außerhalb des Zeitraums aus", () => {
    expect(seasonStats(archive, "2027-07-01", "2028-06-30").matches).toBe(1);
  });
});
