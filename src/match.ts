export type MatchPhase = "setup" | "firstHalf" | "halfTime" | "secondHalf" | "finished";
export type TeamSide = "home" | "away";
export type EventKind = "goal" | "substitution" | "yellow" | "red" | "period";

export interface MatchEvent {
  id: string;
  kind: EventKind;
  team?: TeamSide;
  player?: string;
  playerIn?: string;
  playerOut?: string;
  matchMs: number;
  exactTime: string;
  minute: number;
  label: string;
  createdAt: string;
}

export interface MatchState {
  version: 1;
  ageGroup: string;
  halfDurationMinutes: number;
  homeTeam: string;
  awayTeam: string;
  phase: MatchPhase;
  firstHalfMs: number;
  secondHalfMs: number;
  runningSince: number | null;
  events: MatchEvent[];
  startedAt: string | null;
  finishedAt: string | null;
}

export const ageGroups = [
  { value: "A", label: "A-Jugend · U19/U18", minutes: 45 },
  { value: "B", label: "B-Jugend · U17/U16", minutes: 40 },
  { value: "C", label: "C-Jugend · U15/U14", minutes: 35 },
  { value: "D", label: "D-Jugend · U13/U12", minutes: 30 },
  { value: "E", label: "E-Jugend · U11/U10", minutes: 25 },
  { value: "F", label: "F-Jugend · U9/U8", minutes: 20 },
  { value: "G", label: "G-Jugend · U7", minutes: 20 },
  { value: "custom", label: "Eigene Spielzeit", minutes: 30 },
] as const;

export const initialMatch: MatchState = {
  version: 1,
  ageGroup: "D",
  halfDurationMinutes: 30,
  homeTeam: "Heim",
  awayTeam: "Gast",
  phase: "setup",
  firstHalfMs: 0,
  secondHalfMs: 0,
  runningSince: null,
  events: [],
  startedAt: null,
  finishedAt: null,
};

export function currentHalfMs(state: MatchState, now: number): number {
  const base = state.phase === "secondHalf" ? state.secondHalfMs : state.firstHalfMs;
  return base + (state.runningSince === null ? 0 : Math.max(0, now - state.runningSince));
}

export function regulationMs(state: MatchState): number {
  return state.halfDurationMinutes * 60_000;
}

export function matchTimeMs(state: MatchState, now: number): number {
  if (state.phase === "secondHalf" || state.phase === "finished") {
    return regulationMs(state) + (state.phase === "secondHalf" ? currentHalfMs(state, now) : state.secondHalfMs);
  }
  return currentHalfMs(state, now);
}

export function formatClock(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function displayMinute(milliseconds: number): number {
  return Math.max(0, Math.floor(milliseconds / 60_000));
}

export function score(events: MatchEvent[], side: TeamSide): number {
  return events.filter((event) => event.kind === "goal" && event.team === side).length;
}
