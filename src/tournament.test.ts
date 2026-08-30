import { describe, expect, it } from "vitest";
import { createMatch, type MatchEvent, type SavedMatch } from "./match";
import { createTournament, mergeTournaments, standings, type Tournament } from "./tournament";

function goal(team: "home" | "away"): MatchEvent {
  return { id: Math.random().toString(36).slice(2), kind: "goal", team, matchMs: 0, exactTime: "00:00", minute: 0, label: "Tor", createdAt: "x" };
}

function finishedMatch(id: string, home: string, away: string, homeGoals: number, awayGoals: number): SavedMatch {
  return {
    savedAt: new Date().toISOString(),
    state: createMatch({
      id,
      homeTeam: home,
      awayTeam: away,
      phase: "finished",
      events: [...Array(homeGoals).fill(0).map(() => goal("home")), ...Array(awayGoals).fill(0).map(() => goal("away"))],
    }),
  };
}

describe("standings", () => {
  it("berechnet Punkte, Tordifferenz und Sortierung aus verknüpften Spielen", () => {
    const tournament: Tournament = {
      ...createTournament("Test", "2026-08-30"),
      groups: ["A"],
      fixtures: [
        { id: "f1", group: "A", home: "Adler", away: "Bären", kickoff: "10:00", matchId: "m1" },
        { id: "f2", group: "A", home: "Bären", away: "Adler", kickoff: "11:00", matchId: "m2" },
        { id: "f3", group: "A", home: "Adler", away: "Chamäleon", kickoff: "12:00", matchId: null },
      ],
    };
    const archive = [
      finishedMatch("m1", "Adler", "Bären", 3, 1),
      finishedMatch("m2", "Bären", "Adler", 0, 0),
    ];

    const table = standings(tournament, archive, "A");
    expect(table.map((row) => row.team)).toEqual(["Adler", "Bären", "Chamäleon"]);
    expect(table[0]).toMatchObject({ team: "Adler", played: 2, won: 1, drawn: 1, points: 4, goalDiff: 2 });
    expect(table[1]).toMatchObject({ team: "Bären", points: 1, goalDiff: -2 });
    expect(table[2]).toMatchObject({ team: "Chamäleon", played: 0, points: 0 });
  });

  it("ignoriert nicht abgeschlossene Spiele", () => {
    const tournament: Tournament = {
      ...createTournament("Test", "2026-08-30"),
      fixtures: [{ id: "f1", group: "A", home: "A", away: "B", kickoff: "", matchId: "m1" }],
    };
    const running: SavedMatch = { savedAt: "x", state: createMatch({ id: "m1", phase: "secondHalf", events: [goal("home")] }) };
    expect(standings(tournament, [running], "A").every((row) => row.played === 0)).toBe(true);
  });
});

describe("mergeTournaments", () => {
  it("behält je Turnier-ID die zuletzt geänderte Fassung", () => {
    const a: Tournament = { ...createTournament("Alt", "2026-08-01"), id: "t1", updatedAt: "2026-08-01T00:00:00.000Z" };
    const b: Tournament = { ...createTournament("Neu", "2026-08-01"), id: "t1", updatedAt: "2026-08-30T00:00:00.000Z" };
    const merged = mergeTournaments([a], [b]);
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe("Neu");
  });
});
