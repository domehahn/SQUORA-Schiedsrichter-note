export type MatchPhase =
  | "setup"
  | "firstHalf"
  | "halfTime"
  | "secondHalf"
  | "extraFirst"
  | "extraBreak"
  | "extraSecond"
  | "shootout"
  | "finished"
  | "abandoned";
export type TeamSide = "home" | "away";

const ALL_PHASES: MatchPhase[] = [
  "setup", "firstHalf", "halfTime", "secondHalf", "extraFirst", "extraBreak", "extraSecond", "shootout", "finished", "abandoned",
];

export interface ShootoutAttempt {
  id: string;
  team: TeamSide;
  player?: string;
  scored: boolean;
}

export type EventKind =
  | "goal"
  | "ownGoal"
  | "penaltyGoal"
  | "penaltyMissed"
  | "substitution"
  | "yellow"
  | "yellowRed"
  | "red"
  | "timePenalty"
  | "note"
  | "period";

/** Event kinds a referee records via the quick-capture buttons (everything except automatic period markers). */
export type ActionKind = Exclude<EventKind, "period">;

export type LineupStatus = "start" | "bench" | "out";

export interface Player {
  id: string;
  number: string;
  name: string;
  pass?: string;
  birthdate?: string;
  status?: LineupStatus;
  /** Formation slot key (see formations.ts), only meaningful while status is "start". */
  position?: string;
}

export interface MatchMeta {
  referee: string;
  assistant1: string;
  assistant2: string;
  fourthOfficial: string;
  venue: string;
  competition: string;
  matchday: string;
  spectators: string;
  weather: string;
  pitch: string;
  kickoffDelay: string;
  incidents: string;
  abandonedReason: string;
}

export interface MatchEvent {
  id: string;
  kind: EventKind;
  team?: TeamSide;
  player?: string;
  playerName?: string;
  playerIn?: string;
  playerInName?: string;
  playerOut?: string;
  playerOutName?: string;
  durationMin?: number;
  text?: string;
  matchMs: number;
  exactTime: string;
  minute: number;
  label: string;
  createdAt: string;
  editedAt?: string;
}

export interface MatchState {
  version: 2;
  id: string;
  matchDate: string;
  /** Optional free-text name, e.g. to tell apart several Funino mini-matches played on the same day. */
  matchName: string;
  ageGroup: string;
  halfDurationMinutes: number;
  homeTeam: string;
  awayTeam: string;
  homeRoster: Player[];
  awayRoster: Player[];
  homeFormation: string;
  awayFormation: string;
  meta: MatchMeta;
  tournamentId: string | null;
  fixtureId: string | null;
  phase: MatchPhase;
  firstHalfMs: number;
  secondHalfMs: number;
  extraFirstMs: number;
  extraSecondMs: number;
  runningSince: number | null;
  knockout: boolean;
  extraDurationMinutes: number;
  announcedStoppageMin: number;
  breakStartedAt: string | null;
  breakDurationMin: number;
  shootout: ShootoutAttempt[];
  events: MatchEvent[];
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

export interface SavedMatch {
  savedAt: string;
  state: MatchState;
}

export const ageGroups = [
  { value: "A", label: "A-Jugend · U19/U18", minutes: 45 },
  { value: "B", label: "B-Jugend · U17/U16", minutes: 40 },
  { value: "C", label: "C-Jugend · U15/U14", minutes: 35 },
  { value: "D", label: "D-Jugend · U13/U12", minutes: 30 },
  { value: "E", label: "E-Jugend · U11/U10", minutes: 25 },
  { value: "F", label: "F-Jugend · U9/U8", minutes: 7 },
  { value: "G", label: "G-Jugend (Bambini) · U7", minutes: 6 },
  { value: "H", label: "Herren / Damen", minutes: 45 },
  { value: "custom", label: "Eigene Spielzeit", minutes: 30 },
] as const;

/**
 * F- und G-Jugend (Funino/Bambini) spielen laut FVR-Durchführungsbestimmungen
 * im Turnierspielbetrieb ohne Schiedsrichter mit einer durchgehenden
 * Spielzeit statt zweier Halbzeiten mit Seitenwechsel.
 */
export function isSingleHalfAgeGroup(ageGroup: string): boolean {
  return ageGroup === "F" || ageGroup === "G";
}

export const emptyMeta: MatchMeta = {
  referee: "",
  assistant1: "",
  assistant2: "",
  fourthOfficial: "",
  venue: "",
  competition: "",
  matchday: "",
  spectators: "",
  weather: "",
  pitch: "",
  kickoffDelay: "",
  incidents: "",
  abandonedReason: "",
};

export function todayIso(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function uid(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

export function createMatch(overrides: Partial<MatchState> = {}): MatchState {
  return {
    version: 2,
    id: uid(),
    matchDate: todayIso(),
    matchName: "",
    ageGroup: "D",
    halfDurationMinutes: 30,
    homeTeam: "Heim",
    awayTeam: "Gast",
    homeRoster: [],
    awayRoster: [],
    homeFormation: "",
    awayFormation: "",
    meta: { ...emptyMeta },
    tournamentId: null,
    fixtureId: null,
    phase: "setup",
    firstHalfMs: 0,
    secondHalfMs: 0,
    extraFirstMs: 0,
    extraSecondMs: 0,
    runningSince: null,
    knockout: false,
    extraDurationMinutes: 10,
    announcedStoppageMin: 0,
    breakStartedAt: null,
    breakDurationMin: 10,
    shootout: [],
    events: [],
    startedAt: null,
    finishedAt: null,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Accepts anything from localStorage / sync / import (v1, v2, partial) and returns a valid v2 state. */
export function normalizeMatch(raw: unknown): MatchState {
  if (!raw || typeof raw !== "object") return createMatch();
  const source = raw as Partial<MatchState> & Record<string, unknown>;
  const base = createMatch();
  const events = Array.isArray(source.events)
    ? (source.events as MatchEvent[]).filter((event) => event && typeof event.id === "string" && typeof event.kind === "string")
    : [];
  return {
    ...base,
    ...source,
    version: 2,
    id: typeof source.id === "string" && source.id ? source.id : base.id,
    matchDate: typeof source.matchDate === "string" && source.matchDate ? source.matchDate : todayIso(),
    matchName: typeof source.matchName === "string" ? source.matchName.slice(0, 60) : "",
    homeRoster: sanitizeRoster(source.homeRoster),
    awayRoster: sanitizeRoster(source.awayRoster),
    homeFormation: typeof source.homeFormation === "string" ? source.homeFormation.slice(0, 16) : "",
    awayFormation: typeof source.awayFormation === "string" ? source.awayFormation.slice(0, 16) : "",
    meta: { ...emptyMeta, ...(source.meta && typeof source.meta === "object" ? source.meta : {}) },
    tournamentId: typeof source.tournamentId === "string" ? source.tournamentId : null,
    fixtureId: typeof source.fixtureId === "string" ? source.fixtureId : null,
    phase: isPhase(source.phase) ? source.phase : "setup",
    extraFirstMs: Number(source.extraFirstMs) || 0,
    extraSecondMs: Number(source.extraSecondMs) || 0,
    knockout: source.knockout === true,
    extraDurationMinutes: Number(source.extraDurationMinutes) || 10,
    announcedStoppageMin: Number(source.announcedStoppageMin) || 0,
    breakStartedAt: typeof source.breakStartedAt === "string" ? source.breakStartedAt : null,
    breakDurationMin: Number(source.breakDurationMin) || 10,
    shootout: Array.isArray(source.shootout)
      ? (source.shootout as ShootoutAttempt[])
          .filter((entry) => entry && (entry.team === "home" || entry.team === "away"))
          .map((entry) => ({ id: typeof entry.id === "string" && entry.id ? entry.id : uid(), team: entry.team, player: entry.player ? String(entry.player) : undefined, scored: entry.scored === true }))
      : [],
    events,
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : new Date().toISOString(),
  };
}

function isPhase(value: unknown): value is MatchPhase {
  return typeof value === "string" && (ALL_PHASES as string[]).includes(value);
}

export function sanitizeRoster(value: unknown): Player[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Player => Boolean(entry) && typeof entry === "object")
    .map((entry) => ({
      id: typeof entry.id === "string" && entry.id ? entry.id : uid(),
      number: String(entry.number ?? "").slice(0, 4),
      name: String(entry.name ?? "").slice(0, 60),
      pass: String(entry.pass ?? "").slice(0, 30),
      birthdate: String(entry.birthdate ?? "").slice(0, 12),
      status: entry.status === "start" || entry.status === "bench" || entry.status === "out" ? entry.status : undefined,
      position: typeof entry.position === "string" && entry.position ? entry.position.slice(0, 16) : undefined,
    }))
    .filter((player) => player.number || player.name || player.pass);
}

const RUNNING_FIELD: Partial<Record<MatchPhase, "firstHalfMs" | "secondHalfMs" | "extraFirstMs" | "extraSecondMs">> = {
  firstHalf: "firstHalfMs",
  secondHalf: "secondHalfMs",
  extraFirst: "extraFirstMs",
  extraSecond: "extraSecondMs",
};

/** Elapsed time of the currently running period (half / extra-time half). 0 in breaks, setup, shootout, finished. */
export function currentPeriodMs(state: MatchState, now: number): number {
  const field = RUNNING_FIELD[state.phase];
  if (!field) {
    // during a break, show the just-finished period length
    if (state.phase === "halfTime") return state.firstHalfMs;
    if (state.phase === "extraBreak") return state.extraFirstMs;
    return 0;
  }
  return state[field] + (state.runningSince === null ? 0 : Math.max(0, now - state.runningSince));
}

/** Back-compat alias. */
export const currentHalfMs = currentPeriodMs;

export function regulationMs(state: MatchState): number {
  return state.halfDurationMinutes * 60_000;
}

export function extraPeriodMs(state: MatchState): number {
  return state.extraDurationMinutes * 60_000;
}

/** Target length of whichever period is currently running (regulation or extra-time). */
export function activePeriodTargetMs(state: MatchState): number {
  return state.phase === "extraFirst" || state.phase === "extraSecond" ? extraPeriodMs(state) : regulationMs(state);
}

export function hadExtraTime(state: MatchState): boolean {
  return state.extraFirstMs > 0 || state.extraSecondMs > 0 || state.phase === "extraFirst" || state.phase === "extraBreak" || state.phase === "extraSecond";
}

/** Continuous match clock (cumulative across halves + extra time), used to stamp events. */
export function matchTimeMs(state: MatchState, now: number): number {
  const reg = regulationMs(state);
  const ext = extraPeriodMs(state);
  switch (state.phase) {
    case "setup":
      return 0;
    case "firstHalf":
      return currentPeriodMs(state, now);
    case "halfTime":
      return state.firstHalfMs;
    case "secondHalf":
      return reg + currentPeriodMs(state, now);
    case "extraFirst":
      return 2 * reg + currentPeriodMs(state, now);
    case "extraBreak":
      return 2 * reg + state.extraFirstMs;
    case "extraSecond":
      return 2 * reg + ext + currentPeriodMs(state, now);
    case "shootout":
    case "finished":
    case "abandoned":
      return hadExtraTime(state) ? 2 * reg + ext + state.extraSecondMs : reg + state.secondHalfMs;
  }
}

export function formatClock(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function displayMinute(milliseconds: number): number {
  return Math.max(0, Math.floor(milliseconds / 60_000));
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "–";
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatWallClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "–";
  return date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function matchDateLabel(state: MatchState): string {
  if (state.matchDate) return formatDate(`${state.matchDate}T00:00:00`);
  if (state.startedAt) return formatDate(state.startedAt);
  return "–";
}

const GOAL_KINDS = new Set<EventKind>(["goal", "penaltyGoal"]);

export function score(events: MatchEvent[], side: TeamSide): number {
  const other: TeamSide = side === "home" ? "away" : "home";
  return events.filter((event) => {
    if (GOAL_KINDS.has(event.kind)) return event.team === side;
    if (event.kind === "ownGoal") return event.team === other;
    return false;
  }).length;
}

export function countCards(events: MatchEvent[], side: TeamSide, kind: "yellow" | "yellowRed" | "red"): number {
  return events.filter((event) => event.team === side && event.kind === kind).length;
}

export interface ActiveTimePenalty {
  id: string;
  team: TeamSide;
  label: string;
  remainingMs: number;
}

/** Human label for a player identified by number and/or name. */
export function describePlayer(number: string | undefined, name: string | undefined): string {
  const num = (number ?? "").trim();
  const nm = (name ?? "").trim();
  if (num && nm) return `Nr. ${num} (${nm})`;
  if (num) return `Nr. ${num}`;
  if (nm) return nm;
  return "Nr. ?";
}

export function activeTimePenalties(events: MatchEvent[], currentMatchMs: number): ActiveTimePenalty[] {
  return events
    .filter((event) => event.kind === "timePenalty" && event.team)
    .map((event) => {
      const endsAt = event.matchMs + (event.durationMin ?? 0) * 60_000;
      return { id: event.id, team: event.team as TeamSide, label: describePlayer(event.player, event.playerName), remainingMs: endsAt - currentMatchMs };
    })
    .filter((penalty) => penalty.remainingMs > 0)
    .sort((a, b) => a.remainingMs - b.remainingMs);
}

export const eventMeta: Record<EventKind, { title: string; short: string }> = {
  goal: { title: "Tor", short: "Tor" },
  ownGoal: { title: "Eigentor", short: "Eigentor" },
  penaltyGoal: { title: "Elfmeter – Tor", short: "Elfmeter" },
  penaltyMissed: { title: "Elfmeter – verschossen", short: "Elfm. verschossen" },
  substitution: { title: "Wechsel", short: "Wechsel" },
  yellow: { title: "Gelbe Karte", short: "Gelb" },
  yellowRed: { title: "Gelb-Rote Karte", short: "Gelb-Rot" },
  red: { title: "Rote Karte", short: "Rot" },
  timePenalty: { title: "Zeitstrafe", short: "Zeitstrafe" },
  note: { title: "Notiz / Vorkommnis", short: "Notiz" },
  period: { title: "Spielabschnitt", short: "Abschnitt" },
};

export function teamName(state: MatchState, side?: TeamSide): string {
  if (side === "home") return state.homeTeam || "Heim";
  if (side === "away") return state.awayTeam || "Gast";
  return "Spielabschnitt";
}

export interface EventInput {
  player?: string;
  playerName?: string;
  playerIn?: string;
  playerInName?: string;
  playerOut?: string;
  playerOutName?: string;
  durationMin?: number;
  text?: string;
}

export function buildEventLabel(kind: EventKind, team: string, data: EventInput): string {
  const who = describePlayer(data.player, data.playerName);
  switch (kind) {
    case "goal":
      return `Tor ${team} · ${who}`;
    case "ownGoal":
      return `Eigentor ${team} · ${who}`;
    case "penaltyGoal":
      return `Elfmeter-Tor ${team} · ${who}`;
    case "penaltyMissed":
      return `Elfmeter verschossen ${team} · ${who}`;
    case "yellow":
      return `Gelbe Karte ${team} · ${who}`;
    case "yellowRed":
      return `Gelb-Rote Karte ${team} · ${who}`;
    case "red":
      return `Rote Karte ${team} · ${who}`;
    case "timePenalty":
      return `Zeitstrafe ${data.durationMin ?? 0} min ${team} · ${who}`;
    case "substitution": {
      const out = describePlayer(data.playerOut, data.playerOutName);
      const inn = describePlayer(data.playerIn, data.playerInName);
      return `Wechsel ${team} · ${out} raus, ${inn} rein`;
    }
    case "note":
      return team === "Spielabschnitt" ? `Vorkommnis · ${data.text ?? ""}` : `Vorkommnis ${team} · ${data.text ?? ""}`;
    default:
      return team;
  }
}

export function rosterName(roster: Player[], number: string): string {
  const hit = roster.find((player) => player.number === number.trim());
  return hit?.name ?? "";
}

export function substitutionCount(events: MatchEvent[], side: TeamSide): number {
  return events.filter((event) => event.kind === "substitution" && event.team === side).length;
}

export interface PlayerSanction {
  key: string;
  player: string;
  playerName: string;
  label: string;
  yellow: number;
  yellowRed: number;
  red: number;
  timePenalties: number;
}

/** Identity key for a player – the jersey number if present, otherwise the name. */
export function playerKey(number: string | undefined, name: string | undefined): string {
  return (number ?? "").trim() || (name ?? "").trim();
}

/** Per-player card / sanction summary for one team, ordered by severity. */
export function sanctions(events: MatchEvent[], side: TeamSide): PlayerSanction[] {
  const map = new Map<string, PlayerSanction>();
  for (const event of events) {
    if (event.team !== side) continue;
    if (event.kind !== "yellow" && event.kind !== "yellowRed" && event.kind !== "red" && event.kind !== "timePenalty") continue;
    const key = playerKey(event.player, event.playerName);
    if (!key) continue;
    const row = map.get(key) ?? {
      key,
      player: (event.player ?? "").trim(),
      playerName: (event.playerName ?? "").trim(),
      label: describePlayer(event.player, event.playerName),
      yellow: 0, yellowRed: 0, red: 0, timePenalties: 0,
    };
    if (event.kind === "yellow") row.yellow += 1;
    else if (event.kind === "yellowRed") row.yellowRed += 1;
    else if (event.kind === "red") row.red += 1;
    else row.timePenalties += 1;
    if (!row.player && event.player) row.player = event.player.trim();
    if (!row.playerName && event.playerName) row.playerName = event.playerName.trim();
    row.label = describePlayer(row.player, row.playerName);
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) =>
    (b.red + b.yellowRed) - (a.red + a.yellowRed) || b.yellow - a.yellow || a.key.localeCompare(b.key, "de", { numeric: true }),
  );
}

/** True if this player (matched by number or name) already has a yellow not yet turned into yellow-red for this team. */
export function hasPriorYellow(events: MatchEvent[], side: TeamSide, playerRef: string): boolean {
  const trimmed = playerRef.trim();
  if (!trimmed) return false;
  const matches = (event: MatchEvent) =>
    event.team === side && ((event.player ?? "").trim() === trimmed || (event.playerName ?? "").trim() === trimmed);
  const yellows = events.filter((event) => matches(event) && event.kind === "yellow").length;
  const upgrades = events.filter((event) => matches(event) && (event.kind === "yellowRed" || event.kind === "red")).length;
  return yellows >= 1 && upgrades === 0;
}

export interface ShootoutTally {
  home: number;
  away: number;
  homeTaken: number;
  awayTaken: number;
  decided: boolean;
  winner: TeamSide | null;
  nextTeam: TeamSide;
}

const SHOOTOUT_ROUNDS = 5;

export function shootoutTally(attempts: ShootoutAttempt[]): ShootoutTally {
  let home = 0;
  let away = 0;
  let homeTaken = 0;
  let awayTaken = 0;
  for (const attempt of attempts) {
    if (attempt.team === "home") {
      homeTaken += 1;
      if (attempt.scored) home += 1;
    } else {
      awayTaken += 1;
      if (attempt.scored) away += 1;
    }
  }
  const remainingHome = Math.max(0, SHOOTOUT_ROUNDS - homeTaken);
  const remainingAway = Math.max(0, SHOOTOUT_ROUNDS - awayTaken);
  const inRegulation = homeTaken <= SHOOTOUT_ROUNDS && awayTaken <= SHOOTOUT_ROUNDS;
  let decided = false;
  if (inRegulation && home > away + remainingAway) decided = true;
  else if (inRegulation && away > home + remainingHome) decided = true;
  else if (homeTaken >= SHOOTOUT_ROUNDS && awayTaken >= SHOOTOUT_ROUNDS && homeTaken === awayTaken && home !== away) decided = true;
  const winner = decided ? (home > away ? "home" : "away") : null;
  const nextTeam: TeamSide = attempts.length % 2 === 0 ? "home" : "away";
  return { home, away, homeTaken, awayTaken, decided, winner, nextTeam };
}

export interface AgeRule {
  players: string;
  ball: string;
  field: string;
  subs: string;
  offside: string;
}

/** Orientation values (DFB youth football). Regional match rules take precedence. */
/**
 * Fußballverband Rheinland (FVR), Durchführungsbestimmungen Jugend Teil I,
 * Saison 2026/2027 (Stand 15.07.2026), Abschnitt 4–6 — als Richtwerte für die
 * eigene regionale Spielordnung; verbindlich ist immer der zuständige Verband.
 */
export const ageRules: Record<string, AgeRule> = {
  A: { players: "11 gegen 11 (9 gegen 9 möglich)", ball: "Größe 5", field: "Großfeld – min. 100×60 m (Rheinlandebene), sonst min. 90×45 m", subs: "bis zu 5 Auswechselspieler, Wiedereinwechseln zulässig", offside: "ja" },
  B: { players: "11 gegen 11 (9 gegen 9 möglich)", ball: "Größe 5", field: "Großfeld – min. 100×60 m (Rheinlandebene), sonst min. 90×45 m", subs: "bis zu 5 Auswechselspieler, Wiedereinwechseln zulässig", offside: "ja" },
  C: { players: "11 gegen 11 (Großfeld) oder 9 gegen 9 (58×45 m)", ball: "Größe 5", field: "Großfeld bzw. 58×45 m (C-9, Strafraum zu Strafraum)", subs: "bis zu 5 Auswechselspieler, Wiedereinwechseln zulässig", offside: "ja" },
  D: { players: "9 gegen 9 (7 gegen 7 möglich)", ball: "Leichtspielball Größe 4 (350 g)", field: "ca. 70×50 m, min. 58×45 m (D-9); Platzhälfte quer (D-7)", subs: "unbegrenzt, Wiedereinwechseln zulässig", offside: "ja" },
  E: { players: "7 gegen 7 (inkl. Torwart)", ball: "Leichtspielball Größe 4 (350 g)", field: "Kleinfeld ca. 40×30 m", subs: "bis zu 5 Rotationsspieler", offside: "nein" },
  F: { players: "3 gegen 3 / 3+1 gegen 3+1, Team max. 5", ball: "Leichtspielball Größe 3 (290 g)", field: "ca. 25×20 m · Turnierspielbetrieb ohne Schiedsrichter", subs: "bis zu 2 Rotationsspieler, nach Tor oder spät. 2 Min.", offside: "nein" },
  G: { players: "3 gegen 3, Team max. 5", ball: "Leichtspielball Größe 3 (290 g)", field: "ca. 20×15 m · Turnierspielbetrieb ohne Schiedsrichter", subs: "bis zu 2 Rotationsspieler, nach Tor oder spät. 2 Min.", offside: "nein" },
  H: { players: "11 gegen 11", ball: "Größe 5", field: "Großfeld", subs: "3–5 je nach Wettbewerb (Spielordnung Erwachsene)", offside: "ja" },
};
