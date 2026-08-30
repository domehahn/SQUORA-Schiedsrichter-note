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

export interface Player {
  id: string;
  number: string;
  name: string;
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
  ageGroup: string;
  halfDurationMinutes: number;
  homeTeam: string;
  awayTeam: string;
  homeRoster: Player[];
  awayRoster: Player[];
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
  { value: "F", label: "F-Jugend · U9/U8", minutes: 20 },
  { value: "G", label: "G-Jugend · U7", minutes: 20 },
  { value: "H", label: "Herren / Damen", minutes: 45 },
  { value: "custom", label: "Eigene Spielzeit", minutes: 30 },
] as const;

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
    ageGroup: "D",
    halfDurationMinutes: 30,
    homeTeam: "Heim",
    awayTeam: "Gast",
    homeRoster: [],
    awayRoster: [],
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
    homeRoster: sanitizeRoster(source.homeRoster),
    awayRoster: sanitizeRoster(source.awayRoster),
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
    }))
    .filter((player) => player.number || player.name);
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

export function activeTimePenalties(events: MatchEvent[], currentMatchMs: number): ActiveTimePenalty[] {
  return events
    .filter((event) => event.kind === "timePenalty" && event.team)
    .map((event) => {
      const endsAt = event.matchMs + (event.durationMin ?? 0) * 60_000;
      const who = event.playerName ? `Nr. ${event.player} ${event.playerName}` : `Nr. ${event.player}`;
      return { id: event.id, team: event.team as TeamSide, label: who, remainingMs: endsAt - currentMatchMs };
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
  const who = data.playerName ? `Nr. ${data.player} (${data.playerName})` : `Nr. ${data.player}`;
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
      const out = data.playerOutName ? `Nr. ${data.playerOut} (${data.playerOutName})` : `Nr. ${data.playerOut}`;
      const inn = data.playerInName ? `Nr. ${data.playerIn} (${data.playerInName})` : `Nr. ${data.playerIn}`;
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
  player: string;
  playerName?: string;
  yellow: number;
  yellowRed: number;
  red: number;
  timePenalties: number;
}

/** Per-player card / sanction summary for one team, ordered by severity. */
export function sanctions(events: MatchEvent[], side: TeamSide): PlayerSanction[] {
  const map = new Map<string, PlayerSanction>();
  for (const event of events) {
    if (event.team !== side || !event.player) continue;
    if (event.kind !== "yellow" && event.kind !== "yellowRed" && event.kind !== "red" && event.kind !== "timePenalty") continue;
    const key = event.player;
    const row = map.get(key) ?? { player: key, playerName: event.playerName, yellow: 0, yellowRed: 0, red: 0, timePenalties: 0 };
    if (event.kind === "yellow") row.yellow += 1;
    else if (event.kind === "yellowRed") row.yellowRed += 1;
    else if (event.kind === "red") row.red += 1;
    else row.timePenalties += 1;
    if (!row.playerName && event.playerName) row.playerName = event.playerName;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) =>
    (b.red + b.yellowRed) - (a.red + a.yellowRed) || b.yellow - a.yellow || a.player.localeCompare(b.player, "de", { numeric: true }),
  );
}

/** True if this player already has a yellow (not yet turned into yellow-red) for this team. */
export function hasPriorYellow(events: MatchEvent[], side: TeamSide, player: string): boolean {
  const trimmed = player.trim();
  if (!trimmed) return false;
  const yellows = events.filter((e) => e.team === side && e.player === trimmed && e.kind === "yellow").length;
  const upgrades = events.filter((e) => e.team === side && e.player === trimmed && (e.kind === "yellowRed" || e.kind === "red")).length;
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
export const ageRules: Record<string, AgeRule> = {
  A: { players: "11 gegen 11", ball: "Größe 5", field: "Großfeld", subs: "Wiedereintritt je nach Spielordnung", offside: "ja" },
  B: { players: "11 gegen 11", ball: "Größe 5", field: "Großfeld", subs: "Wiedereintritt je nach Spielordnung", offside: "ja" },
  C: { players: "11 gegen 11", ball: "Größe 5", field: "Großfeld", subs: "Wiederholtes Wechseln erlaubt", offside: "ja" },
  D: { players: "9 gegen 9", ball: "Größe 4", field: "verkleinertes Großfeld", subs: "fliegender Wechsel", offside: "nein (meist)" },
  E: { players: "7 gegen 7", ball: "Größe 4", field: "Kleinfeld", subs: "fliegender Wechsel", offside: "nein" },
  F: { players: "5–7, oft Funino 3+3", ball: "Größe 3/4", field: "Kleinfeld / Mini", subs: "fliegender Wechsel", offside: "nein" },
  G: { players: "Funino / 2–5", ball: "Größe 3", field: "Minispielfeld", subs: "frei", offside: "nein" },
  H: { players: "11 gegen 11", ball: "Größe 5", field: "Großfeld", subs: "3–5 je nach Wettbewerb", offside: "ja" },
};
