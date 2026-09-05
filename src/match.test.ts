import { describe, expect, it } from "vitest";
import {
  activeTimePenalties,
  buildEventLabel,
  createMatch,
  hasPriorYellow,
  isSingleHalfAgeGroup,
  matchTimeMs,
  normalizeMatch,
  playerTimes,
  sanctions,
  score,
  shootoutTally,
  substitutionCount,
  type MatchEvent,
  type MatchState,
  type Player,
  type ShootoutAttempt,
} from "./match";

function ev(partial: Partial<MatchEvent>): MatchEvent {
  return {
    id: Math.random().toString(36).slice(2),
    kind: "goal",
    matchMs: 0,
    exactTime: "00:00",
    minute: 0,
    label: "",
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

describe("score", () => {
  it("zählt Tore, Elfmetertore und Eigentore für die richtige Mannschaft", () => {
    const events = [
      ev({ kind: "goal", team: "home" }),
      ev({ kind: "penaltyGoal", team: "home" }),
      ev({ kind: "penaltyMissed", team: "home" }),
      ev({ kind: "goal", team: "away" }),
      ev({ kind: "ownGoal", team: "away" }), // zählt für home
      ev({ kind: "yellow", team: "home" }),
    ];
    expect(score(events, "home")).toBe(3);
    expect(score(events, "away")).toBe(1);
  });
});

describe("matchTimeMs", () => {
  it("rechnet die 2. Halbzeit auf die fortlaufende Spielzeit auf", () => {
    const base = createMatch({ halfDurationMinutes: 30, phase: "secondHalf", secondHalfMs: 5 * 60_000, runningSince: null });
    expect(matchTimeMs(base, Date.now())).toBe(35 * 60_000);
  });

  it("addiert Verlängerungszeit fortlaufend", () => {
    const base = createMatch({ halfDurationMinutes: 30, extraDurationMinutes: 10, phase: "extraSecond", extraSecondMs: 3 * 60_000, runningSince: null });
    expect(matchTimeMs(base, Date.now())).toBe((60 + 10 + 3) * 60_000);
  });
});

describe("shootoutTally", () => {
  const mk = (pattern: ["home" | "away", boolean][]): ShootoutAttempt[] =>
    pattern.map(([team, scored], index) => ({ id: `s${index}`, team, scored }));

  it("entscheidet vorzeitig, wenn ein Rückstand nicht mehr aufzuholen ist", () => {
    const tally = shootoutTally(mk([
      ["home", true], ["away", false],
      ["home", true], ["away", false],
      ["home", true], ["away", false],
    ]));
    expect(tally.decided).toBe(true);
    expect(tally.winner).toBe("home");
  });

  it("geht bei 5:5 ins Sudden Death und entscheidet erst bei ungleichem Ausgang nach gleicher Schusszahl", () => {
    const five = mk([
      ["home", true], ["away", true], ["home", true], ["away", true], ["home", true],
      ["away", true], ["home", true], ["away", true], ["home", true], ["away", true],
    ]);
    expect(shootoutTally(five).decided).toBe(false);
    const suddenHome = shootoutTally([...five, { id: "x", team: "home", scored: true }]);
    expect(suddenHome.decided).toBe(false); // away hat noch einen Schuss
    const suddenDecided = shootoutTally([...five, { id: "x", team: "home", scored: true }, { id: "y", team: "away", scored: false }]);
    expect(suddenDecided.decided).toBe(true);
    expect(suddenDecided.winner).toBe("home");
  });

  it("wechselt die Schützen abwechselnd, Heim beginnt", () => {
    expect(shootoutTally([]).nextTeam).toBe("home");
    expect(shootoutTally(mk([["home", true]])).nextTeam).toBe("away");
  });
});

describe("sanctions & hasPriorYellow", () => {
  const events = [
    ev({ kind: "yellow", team: "home", player: "6", playerName: "Kern" }),
    ev({ kind: "yellow", team: "home", player: "6" }),
    ev({ kind: "red", team: "away", player: "4" }),
    ev({ kind: "timePenalty", team: "home", player: "9", durationMin: 5 }),
    ev({ kind: "substitution", team: "home", playerOut: "1", playerIn: "12" }),
  ];

  it("fasst Karten je Spieler zusammen", () => {
    const home = sanctions(events, "home");
    expect(home.find((row) => row.player === "6")).toMatchObject({ yellow: 2, playerName: "Kern" });
    expect(home.find((row) => row.player === "9")).toMatchObject({ timePenalties: 1 });
    expect(substitutionCount(events, "home")).toBe(1);
  });

  it("erkennt eine offene erste Gelbe", () => {
    expect(hasPriorYellow([ev({ kind: "yellow", team: "home", player: "6" })], "home", "6")).toBe(true);
    expect(hasPriorYellow([
      ev({ kind: "yellow", team: "home", player: "6" }),
      ev({ kind: "yellowRed", team: "home", player: "6" }),
    ], "home", "6")).toBe(false);
    expect(hasPriorYellow([], "home", "6")).toBe(false);
  });
});

describe("activeTimePenalties", () => {
  it("liefert nur noch laufende Zeitstrafen mit Restzeit", () => {
    const events = [
      ev({ kind: "timePenalty", team: "home", player: "7", durationMin: 5, matchMs: 10 * 60_000 }),
      ev({ kind: "timePenalty", team: "away", player: "4", durationMin: 2, matchMs: 1 * 60_000 }),
    ];
    const active = activeTimePenalties(events, 12 * 60_000);
    expect(active).toHaveLength(1);
    expect(active[0].team).toBe("home");
    expect(active[0].remainingMs).toBe(3 * 60_000);
  });
});

describe("buildEventLabel", () => {
  it("nennt den Namen, wenn er hinterlegt ist", () => {
    expect(buildEventLabel("goal", "SV Blau", { player: "9", playerName: "Meier" })).toBe("Tor SV Blau · Nr. 9 (Meier)");
    expect(buildEventLabel("substitution", "SV Blau", { playerOut: "8", playerIn: "14" })).toBe("Wechsel SV Blau · Nr. 8 raus, Nr. 14 rein");
    expect(buildEventLabel("timePenalty", "FC Rot", { player: "5", durationMin: 10 })).toBe("Zeitstrafe 10 min FC Rot · Nr. 5");
  });
});

describe("isSingleHalfAgeGroup", () => {
  it("gilt nur für F- und G-Jugend (Funino/Bambini)", () => {
    expect(isSingleHalfAgeGroup("F")).toBe(true);
    expect(isSingleHalfAgeGroup("G")).toBe(true);
    expect(isSingleHalfAgeGroup("E")).toBe(false);
    expect(isSingleHalfAgeGroup("D")).toBe(false);
    expect(isSingleHalfAgeGroup("custom")).toBe(false);
  });
});

describe("normalizeMatch", () => {
  it("hebt einen alten v1-Datensatz verlustfrei auf v2 an", () => {
    const legacy = {
      version: 1,
      id: "abc",
      ageGroup: "D",
      halfDurationMinutes: 30,
      homeTeam: "A",
      awayTeam: "B",
      phase: "finished",
      firstHalfMs: 1800000,
      secondHalfMs: 1800000,
      runningSince: null,
      events: [{ id: "e1", kind: "goal", team: "home", matchMs: 0, exactTime: "00:00", minute: 0, label: "Tor", createdAt: "x" }],
      startedAt: null,
      finishedAt: null,
    };
    const next = normalizeMatch(legacy);
    expect(next.version).toBe(2);
    expect(next.id).toBe("abc");
    expect(next.homeRoster).toEqual([]);
    expect(next.meta.venue).toBe("");
    expect(next.tournamentId).toBeNull();
    expect(next.events).toHaveLength(1);
    expect(next.homeFormation).toBe("");
    expect(next.awayFormation).toBe("");
  });

  it("liefert einen frischen Zustand für Müll-Eingaben", () => {
    expect(normalizeMatch(null).phase).toBe("setup");
    expect(normalizeMatch("nope").events).toEqual([]);
  });

  it("übernimmt eine gespeicherte Formation und Spielerposition", () => {
    const next = normalizeMatch({
      homeFormation: "4-3-3",
      homeRoster: [{ id: "p1", number: "9", name: "Max Testspieler", status: "start", position: "L2-1" }],
    });
    expect(next.homeFormation).toBe("4-3-3");
    expect(next.homeRoster[0].position).toBe("L2-1");
  });

  it("übernimmt einen optionalen Spielnamen, sonst leer", () => {
    expect(normalizeMatch({ matchName: "Funino Feld 2, Runde 3" }).matchName).toBe("Funino Feld 2, Runde 3");
    expect(createMatch().matchName).toBe("");
    expect(normalizeMatch({}).matchName).toBe("");
  });
});

describe("playerTimes", () => {
  const player = (number: string, name: string, status: Player["status"]): Player => ({ id: `p${number}`, number, name, status });

  function baseMatch(overrides: Partial<MatchState> = {}): MatchState {
    return createMatch({
      homeRoster: [
        player("1", "Torwart Testspieler", "start"),
        player("5", "Anna Beispiel", "start"),
        player("9", "Kim Musterkind", "start"),
        player("12", "Bank Eins", "bench"),
        player("13", "Bank Zwei", "bench"),
        player("14", "Nicht Nominiert", "out"),
      ],
      ...overrides,
    });
  }

  it("zählt Startspieler ab Anpfiff (0) als bereits eingesetzt, sobald Spielzeit vergangen ist", () => {
    const state = baseMatch();
    const times = playerTimes(state, "home", 10 * 60_000);
    const starter = times.find((entry) => entry.key === "9")!;
    expect(starter.onPitchMs).toBe(10 * 60_000);
    expect(starter.hasPlayed).toBe(true);
    expect(starter.currentlyOn).toBe(true);
  });

  it("markiert Bankspieler ohne Einwechslung als noch nicht eingesetzt", () => {
    const state = baseMatch();
    const times = playerTimes(state, "home", 20 * 60_000);
    const bench = times.filter((entry) => entry.status === "bench");
    expect(bench).toHaveLength(2);
    expect(bench.every((entry) => entry.hasPlayed === false && entry.onPitchMs === 0)).toBe(true);
  });

  it("berechnet die Spielzeit anhand einer Auswechslung", () => {
    const state = baseMatch({
      events: [ev({
        kind: "substitution", team: "home", matchMs: 15 * 60_000,
        playerOut: "9", playerOutName: "Kim Musterkind", playerIn: "12", playerInName: "Bank Eins",
      })],
    });
    const times = playerTimes(state, "home", 30 * 60_000);
    const out = times.find((entry) => entry.key === "9")!;
    const inn = times.find((entry) => entry.key === "12")!;
    expect(out.onPitchMs).toBe(15 * 60_000);
    expect(out.hasPlayed).toBe(true);
    expect(out.currentlyOn).toBe(false);
    expect(inn.onPitchMs).toBe(15 * 60_000);
    expect(inn.hasPlayed).toBe(true);
    expect(inn.currentlyOn).toBe(true);
  });

  it("unterstützt eine erneute Einwechslung (Wiedereinwechseln zulässig) und summiert mehrere Einsätze", () => {
    const state = baseMatch({
      events: [
        ev({ kind: "substitution", team: "home", matchMs: 10 * 60_000, playerOut: "9", playerOutName: "Kim Musterkind", playerIn: "12", playerInName: "Bank Eins" }),
        ev({ kind: "substitution", team: "home", matchMs: 20 * 60_000, playerOut: "12", playerOutName: "Bank Eins", playerIn: "9", playerInName: "Kim Musterkind" }),
      ],
    });
    const times = playerTimes(state, "home", 30 * 60_000);
    const musterkind = times.find((entry) => entry.key === "9")!;
    // 0-10 min (Start) + 20-30 min (zweiter Einsatz) = 20 min
    expect(musterkind.onPitchMs).toBe(20 * 60_000);
    expect(musterkind.currentlyOn).toBe(true);
    const bankEins = times.find((entry) => entry.key === "12")!;
    expect(bankEins.onPitchMs).toBe(10 * 60_000);
    expect(bankEins.currentlyOn).toBe(false);
  });

  it("schließt nicht nominierte Spieler aus", () => {
    const times = playerTimes(baseMatch(), "home", 10 * 60_000);
    expect(times.some((entry) => entry.key === "14")).toBe(false);
  });

  it("legt einen Eintrag für einen eingewechselten Spieler an, der nicht im Kader stand", () => {
    const state = baseMatch({
      events: [ev({
        kind: "substitution", team: "home", matchMs: 5 * 60_000,
        playerOut: "9", playerOutName: "Kim Musterkind", playerIn: "99", playerInName: "Nachmeldung",
      })],
    });
    const times = playerTimes(state, "home", 10 * 60_000);
    const late = times.find((entry) => entry.key === "99")!;
    expect(late.name).toBe("Nachmeldung");
    expect(late.status).toBe("bench");
    expect(late.onPitchMs).toBe(5 * 60_000);
  });
});
