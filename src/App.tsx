import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./icons";
import { EventDialog, type DialogRequest } from "./EventDialog";
import { MatchReport } from "./MatchReport";
import { useWakeLock } from "./useWakeLock";
import { cue, unlockAudio } from "./notify";
import { TenantGate } from "./TenantGate";
import { RosterEditor } from "./RosterEditor";
import { PitchView } from "./PitchView";
import { CollapsibleSection, MetaPanel, SessionExpiredModal, StatsPanel, TeamActions, TeamLibraryPanel, TournamentPanel, TournamentReport } from "./panels";
import { TeamRosterPanel } from "./TeamRosterPanel";
import { downloadBlob, downloadJson } from "./download";
import { ACTIVE_TENANT_KEY, SOUND_KEY } from "./localData";
import { readEncryptedCache, writeEncryptedCache } from "./encryptedCache";
import { scopeKey, type TeamUnit, type TenantMeta } from "./tenant";
import {
  applyDeletions,
  fetchTenantData,
  mergeArchives,
  pushTenantData,
  sanitizeArchive,
  type CloudData,
  type SyncState,
} from "./sync";
import {
  ageGroups,
  ageRules,
  activePeriodTargetMs,
  activeTimePenalties,
  buildEventLabel,
  createMatch,
  currentPeriodMs,
  displayMinute,
  formatClock,
  formatDate,
  formatWallClock,
  hadExtraTime,
  hasPriorYellow,
  matchDateLabel,
  matchTimeMs,
  normalizeMatch,
  sanctions,
  score,
  shootoutTally,
  substitutionCount,
  teamName,
  todayIso,
  uid,
  type ActionKind,
  type MatchEvent,
  type MatchPhase,
  type MatchState,
  type Player,
  type SavedMatch,
  type TeamSide,
} from "./match";
import {
  createTournament,
  mergeTournaments,
  sanitizeTournaments,
  type Fixture,
  type Tournament,
} from "./tournament";
import { createHistoryEntry, createSavedTeam, isHistory, mergeTeams, type SavedTeam } from "./teams";
import { parseDfbnetRoster } from "./dfbnet";
import { readCsvFile } from "./integrations/dfbnet/decode";
import { statsCsvRows } from "./stats";
import { toCsv } from "./csv";

const EDITABLE_DURATION_GROUPS = new Set(["F", "G", "custom"]);
const TIME_RE = /^(\d{1,3}):([0-5]?\d)$/;

const RUNNING_FIELD_BY_PHASE: Partial<Record<MatchPhase, "firstHalfMs" | "secondHalfMs" | "extraFirstMs" | "extraSecondMs">> = {
  firstHalf: "firstHalfMs",
  secondHalf: "secondHalfMs",
  extraFirst: "extraFirstMs",
  extraSecond: "extraSecondMs",
};

function seasonBounds(today = new Date()): { from: string; to: string } {
  const year = today.getFullYear();
  const startYear = today.getMonth() >= 6 ? year : year - 1; // Saison ab 1. Juli
  return { from: `${startYear}-07-01`, to: `${startYear + 1}-06-30` };
}

const nowIso = () => new Date().toISOString();

function parseTimeText(text: string): number | null {
  const match = TIME_RE.exec(text.trim());
  return match ? (Number(match[1]) * 60 + Number(match[2])) * 1000 : null;
}

function loadSound(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) === "1";
  } catch {
    return false;
  }
}

const syncStatusLabel: Record<SyncState, string> = {
  idle: "Auf diesem Gerät gespeichert",
  syncing: "Wird synchronisiert…",
  synced: "Geräteübergreifend gespeichert",
  offline: "Offline · nur auf diesem Gerät",
  error: "Sync-Fehler · erneut versuchen",
  conflict: "Versionskonflikt · neu laden",
};

interface Notice {
  text: string;
  undo?: MatchState;
}

interface AppProps {
  userId: string;
  tenant: TenantMeta;
  team: TeamUnit;
  cryptoKey: CryptoKey | null;
  onLock: () => void;
}

function App({ userId, tenant, team, cryptoKey, onLock }: AppProps) {
  const tenantId = tenant.id;
  const teamId = team.id;
  const cacheScope = scopeKey(userId, tenant.id, team.id);
  const [match, setMatch] = useState<MatchState>(createMatch);
  const [archive, setArchive] = useState<SavedMatch[]>([]);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [teams, setTeams] = useState<SavedTeam[]>([]);
  const [soundOn, setSoundOn] = useState<boolean>(loadSound);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [dialog, setDialog] = useState<DialogRequest | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [printTarget, setPrintTarget] = useState<MatchState | null>(null);
  const [printTournament, setPrintTournament] = useState<Tournament | null>(null);
  const [openPanel, setOpenPanel] = useState<"cards" | "meta" | "roster" | "myroster" | "teams" | "tournaments" | "stats" | null>(null);
  const [showLog, setShowLog] = useState(true);
  const [statsRange, setStatsRange] = useState(() => seasonBounds());

  const noticeTimer = useRef<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const bootstrapped = useRef(false);
  const latest = useRef<CloudData>({ archive, deletedIds, tournaments, teams, current: match });
  latest.current = { archive, deletedIds, tournaments, teams, current: match };

  useWakeLock(match.runningSince !== null);

  useEffect(() => { try { localStorage.setItem(SOUND_KEY, soundOn ? "1" : "0"); } catch { /* ignore */ } }, [soundOn]);

  useEffect(() => {
    const check = async () => {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}api/v1/me`, { headers: { Accept: "application/json" } });
        if (response.status === 401) setSessionExpired(true);
      } catch {
        /* offline – ignore */
      }
    };
    const id = window.setInterval(check, 4 * 60 * 1000);
    return () => window.clearInterval(id);
  }, []);

  const reconcile = (remote: CloudData): CloudData => {
    const mergedDeleted = [...new Set([...latest.current.deletedIds, ...remote.deletedIds])];
    const mergedArchive = applyDeletions(mergeArchives(latest.current.archive, remote.archive), mergedDeleted);
    const mergedTournaments = mergeTournaments(latest.current.tournaments, remote.tournaments);
    const mergedTeams = mergeTeams(latest.current.teams, remote.teams);
    setArchive(mergedArchive);
    setDeletedIds(mergedDeleted);
    setTournaments(mergedTournaments);
    setTeams(mergedTeams);

    let current = latest.current.current;
    if (remote.current && current && current.phase === "setup" && current.events.length === 0 && remote.current.id !== current.id) {
      current = remote.current;
      setMatch(remote.current);
    }
    return { archive: mergedArchive, deletedIds: mergedDeleted, tournaments: mergedTournaments, teams: mergedTeams, current };
  };

  // The offline cache is optional: without a passphrase (online-only) the key is
  // null and nothing is read from or written to IndexedDB.
  const loadCache = () => (cryptoKey ? readEncryptedCache(cacheScope, cryptoKey) : Promise.resolve(null));
  const saveCache = (data: CloudData) => (cryptoKey ? writeEncryptedCache(cacheScope, cryptoKey, data) : Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    setSyncState("syncing");
    Promise.all([loadCache(), fetchTenantData(tenantId, teamId, cryptoKey)]).then(async ([cached, result]) => {
      if (cancelled) return;
      if (!result.ok) {
        if (cached) reconcile(cached);
        if (result.reason === "unauthorized") setSessionExpired(true);
        setSyncState(result.reason === "unauthorized" ? "error" : "offline");
        bootstrapped.current = true;
        return;
      }
      if (cached) {
        latest.current = cached;
        reconcile(cached);
      }
      const merged = reconcile(result.data);
      await saveCache(merged);
      const ok = await pushTenantData(tenantId, teamId, cryptoKey, merged);
      if (cancelled) return;
      setSyncState(ok ? "synced" : "offline");
      if (ok) setLastSyncedAt(Date.now());
      bootstrapped.current = true;
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!bootstrapped.current) return;
    setSyncState("syncing");
    const handle = window.setTimeout(async () => {
      const data = { archive, deletedIds, tournaments, teams, current: match };
      await saveCache(data);
      const ok = await pushTenantData(tenantId, teamId, cryptoKey, data);
      setSyncState(ok ? "synced" : "error");
      if (ok) setLastSyncedAt(Date.now());
    }, 1500);
    return () => window.clearTimeout(handle);
  }, [archive, deletedIds, tournaments, teams, match, tenantId, teamId, cacheScope, cryptoKey]);

  const inBreakPhase = match.phase === "halfTime" || match.phase === "extraBreak";
  useEffect(() => {
    const period = match.runningSince !== null ? 250 : inBreakPhase ? 500 : 20000;
    const timer = window.setInterval(() => setNow(Date.now()), period);
    return () => window.clearInterval(timer);
  }, [match.runningSince, inBreakPhase]);

  useEffect(() => {
    if (!printTarget && !printTournament) return;
    const timer = window.setTimeout(() => window.print(), 80);
    const clear = () => {
      setPrintTarget(null);
      setPrintTournament(null);
    };
    window.addEventListener("afterprint", clear);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("afterprint", clear);
    };
  }, [printTarget, printTournament]);

  const isArchived = archive.some((entry) => entry.state.id === match.id);

  const inPlay = match.phase !== "setup" && match.phase !== "finished" && match.phase !== "abandoned";
  useEffect(() => {
    const dirty = inPlay || (match.events.length > 0 && !isArchived);
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [match.phase, match.events.length, isArchived]);

  const runningField = RUNNING_FIELD_BY_PHASE[match.phase];
  const activeHalf = Boolean(runningField);
  const inBreak = match.phase === "halfTime" || match.phase === "extraBreak";
  const inShootout = match.phase === "shootout";
  const canRecord = activeHalf || inBreak;
  const periodMs = currentPeriodMs(match, now);
  const periodTargetMs = activePeriodTargetMs(match);
  const periodUnlocked = periodMs >= periodTargetMs;
  const stoppageMs = Math.max(0, periodMs - periodTargetMs);
  const stoppageTargetMs = periodTargetMs + match.announcedStoppageMin * 60_000;
  const reachedStoppageTarget = activeHalf && match.announcedStoppageMin > 0 && periodMs >= stoppageTargetMs;
  const breakRemainingMs = inBreak && match.breakStartedAt
    ? match.breakDurationMin * 60_000 - (now - new Date(match.breakStartedAt).getTime())
    : 0;
  const homeScore = score(match.events, "home");
  const awayScore = score(match.events, "away");
  const level = homeScore === awayScore;
  const liveMatchMs = matchTimeMs(match, now);
  const penalties = activeTimePenalties(match.events, liveMatchMs);
  const shoot = shootoutTally(match.shootout);

  const flash = (text: string, undo?: MatchState) => {
    setNotice({ text, undo });
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), undo ? 6000 : 2600);
  };

  const buzz = (kind: Parameters<typeof cue>[0]) => cue(kind, soundOn);

  const patchMatch = (patch: Partial<MatchState>) => setMatch((state) => ({ ...state, ...patch, updatedAt: nowIso() }));

  const stoppageAlerted = useRef<string | null>(null);
  useEffect(() => {
    if (!reachedStoppageTarget) return;
    const key = `${match.phase}-${match.announcedStoppageMin}`;
    if (stoppageAlerted.current === key) return;
    stoppageAlerted.current = key;
    buzz("alert");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reachedStoppageTarget, match.phase, match.announcedStoppageMin]);

  const breakAlerted = useRef<string | null>(null);
  useEffect(() => {
    if (!inBreak) {
      breakAlerted.current = null;
      return;
    }
    if (match.breakStartedAt && breakRemainingMs <= 0 && breakAlerted.current !== match.breakStartedAt) {
      breakAlerted.current = match.breakStartedAt;
      buzz("alert");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inBreak, match.breakStartedAt, breakRemainingMs <= 0]);

  const freezeClock = (state: MatchState, timestamp: number): MatchState => {
    if (state.runningSince === null) return state;
    const field = RUNNING_FIELD_BY_PHASE[state.phase];
    if (!field) return { ...state, runningSince: null };
    const elapsed = Math.max(0, timestamp - state.runningSince);
    return { ...state, [field]: state[field] + elapsed, runningSince: null };
  };

  const addPeriodEvent = (state: MatchState, label: string, timestamp: number): MatchState => {
    const timeMs = matchTimeMs(state, timestamp);
    const event: MatchEvent = {
      id: uid(), kind: "period", matchMs: timeMs, exactTime: formatClock(timeMs),
      minute: displayMinute(timeMs), label, createdAt: nowIso(),
    };
    return { ...state, events: [...state.events, event] };
  };

  const stoppageSuffix = (state: MatchState) => (state.announcedStoppageMin > 0 ? ` (+${state.announcedStoppageMin} angezeigt)` : "");

  const startMatch = () => {
    unlockAudio();
    const timestamp = Date.now();
    setNow(timestamp);
    setMatch((state) => addPeriodEvent({ ...state, phase: "firstHalf", runningSince: timestamp, startedAt: new Date(timestamp).toISOString(), updatedAt: nowIso() }, "Anpfiff · 1. Halbzeit", timestamp));
    buzz("half");
  };

  const toggleClock = () => {
    const timestamp = Date.now();
    setNow(timestamp);
    setMatch((state) => state.runningSince === null
      ? { ...state, runningSince: timestamp, updatedAt: nowIso() }
      : { ...freezeClock(state, timestamp), updatedAt: nowIso() });
  };

  const finishFirstHalf = () => {
    if (!periodUnlocked) return;
    const timestamp = Date.now();
    setNow(timestamp);
    const snapshot = match;
    setMatch((state) => {
      const frozen = freezeClock(state, timestamp);
      return { ...addPeriodEvent(frozen, `Halbzeit${stoppageSuffix(state)}`, timestamp), phase: "halfTime", breakStartedAt: new Date(timestamp).toISOString(), announcedStoppageMin: 0, updatedAt: nowIso() };
    });
    buzz("half");
    flash("Halbzeit gespeichert", snapshot);
  };

  const startSecondHalf = () => {
    const timestamp = Date.now();
    setNow(timestamp);
    setMatch((state) => addPeriodEvent({ ...state, phase: "secondHalf", runningSince: timestamp, breakStartedAt: null, updatedAt: nowIso() }, "Anpfiff · 2. Halbzeit", timestamp));
    buzz("half");
  };

  const finishMatch = () => {
    if (!periodUnlocked) return;
    const timestamp = Date.now();
    setNow(timestamp);
    const snapshot = match;
    setMatch((state) => {
      const frozen = freezeClock(state, timestamp);
      return { ...addPeriodEvent(frozen, `Spielende${stoppageSuffix(state)}`, timestamp), phase: "finished", finishedAt: new Date(timestamp).toISOString(), announcedStoppageMin: 0, updatedAt: nowIso() };
    });
    buzz("end");
    flash("Spielbericht ist abgeschlossen", snapshot);
  };

  const startExtraTime = () => {
    if (!periodUnlocked) return;
    const timestamp = Date.now();
    setNow(timestamp);
    setMatch((state) => {
      const frozen = freezeClock(state, timestamp);
      return { ...addPeriodEvent(frozen, "Beginn Verlängerung · 1. Halbzeit", timestamp), phase: "extraFirst", extraFirstMs: 0, runningSince: timestamp, announcedStoppageMin: 0, updatedAt: nowIso() };
    });
    buzz("half");
    flash("Verlängerung gestartet");
  };

  const finishExtraFirst = () => {
    if (!periodUnlocked) return;
    const timestamp = Date.now();
    setNow(timestamp);
    setMatch((state) => {
      const frozen = freezeClock(state, timestamp);
      return { ...addPeriodEvent(frozen, `Ende 1. Halbzeit Verlängerung${stoppageSuffix(state)}`, timestamp), phase: "extraBreak", breakStartedAt: new Date(timestamp).toISOString(), announcedStoppageMin: 0, updatedAt: nowIso() };
    });
    buzz("half");
  };

  const startExtraSecond = () => {
    const timestamp = Date.now();
    setNow(timestamp);
    setMatch((state) => addPeriodEvent({ ...state, phase: "extraSecond", runningSince: timestamp, breakStartedAt: null, updatedAt: nowIso() }, "Beginn 2. Halbzeit Verlängerung", timestamp));
    buzz("half");
  };

  const finishExtraTime = () => {
    if (!periodUnlocked) return;
    const timestamp = Date.now();
    setNow(timestamp);
    setMatch((state) => {
      const frozen = freezeClock(state, timestamp);
      const stillLevel = score(state.events, "home") === score(state.events, "away");
      if (state.knockout && stillLevel) {
        return { ...addPeriodEvent(frozen, `Ende Verlängerung${stoppageSuffix(state)} · Elfmeterschießen`, timestamp), phase: "shootout", announcedStoppageMin: 0, updatedAt: nowIso() };
      }
      return { ...addPeriodEvent(frozen, `Spielende n. Verl.${stoppageSuffix(state)}`, timestamp), phase: "finished", finishedAt: new Date(timestamp).toISOString(), announcedStoppageMin: 0, updatedAt: nowIso() };
    });
    buzz("end");
  };

  const recordShootout = (scored: boolean) => {
    const timestamp = Date.now();
    setNow(timestamp);
    setMatch((state) => {
      const tally = shootoutTally(state.shootout);
      return { ...state, shootout: [...state.shootout, { id: uid(), team: tally.nextTeam, scored }], updatedAt: nowIso() };
    });
    buzz("event");
  };

  const undoShootout = () => {
    setMatch((state) => ({ ...state, shootout: state.shootout.slice(0, -1), updatedAt: nowIso() }));
  };

  const finishShootout = () => {
    const tally = shootoutTally(match.shootout);
    if (!tally.decided) return;
    const timestamp = Date.now();
    setNow(timestamp);
    const winnerName = tally.winner === "home" ? teamName(match, "home") : teamName(match, "away");
    setMatch((state) => ({
      ...addPeriodEvent(state, `Sieg im Elfmeterschießen: ${winnerName} (${tally.home}:${tally.away})`, timestamp),
      phase: "finished",
      finishedAt: new Date(timestamp).toISOString(),
      updatedAt: nowIso(),
    }));
    buzz("end");
    flash(`${winnerName} gewinnt im Elfmeterschießen`);
  };

  const announceStoppage = () => {
    const input = window.prompt("Nachspielzeit ansagen (Minuten, 0 = keine):", String(match.announcedStoppageMin || ""));
    if (input === null) return;
    const minutes = Math.max(0, Math.min(30, Math.round(Number(input) || 0)));
    patchMatch({ announcedStoppageMin: minutes });
    flash(minutes > 0 ? `Nachspielzeit +${minutes} min angesagt` : "Nachspielzeit-Ansage entfernt");
  };

  const abandonMatch = () => {
    const reason = window.prompt("Grund für den Spielabbruch:", match.meta.abandonedReason || "");
    if (reason === null) return;
    const timestamp = Date.now();
    setNow(timestamp);
    const snapshot = match;
    setMatch((state) => {
      const frozen = freezeClock(state, timestamp);
      return {
        ...addPeriodEvent(frozen, `Spielabbruch – ${reason.trim() || "ohne Angabe"}`, timestamp),
        phase: "abandoned",
        finishedAt: new Date(timestamp).toISOString(),
        meta: { ...state.meta, abandonedReason: reason.trim() },
        updatedAt: nowIso(),
      };
    });
    buzz("end");
    flash("Spielabbruch dokumentiert", snapshot);
  };

  const correctClock = () => {
    const field = RUNNING_FIELD_BY_PHASE[match.phase];
    if (!field) {
      flash("Uhr nur während einer laufenden Halbzeit korrigierbar");
      return;
    }
    const input = window.prompt("Laufzeit dieser Halbzeit auf MM:SS setzen:", formatClock(periodMs));
    if (input === null) return;
    const target = parseTimeText(input);
    if (target === null) {
      flash("Bitte im Format MM:SS eingeben");
      return;
    }
    const timestamp = Date.now();
    const snapshot = match;
    setMatch((state) => ({ ...state, [field]: target, runningSince: state.runningSince !== null ? timestamp : null, updatedAt: nowIso() }));
    setNow(timestamp);
    flash("Uhr korrigiert", snapshot);
  };

  const handleDialogSave = ({ kind, data, timeText }: Parameters<React.ComponentProps<typeof EventDialog>["onSave"]>[0]) => {
    if (!dialog) return;
    const snapshot = match;
    const timeMs = parseTimeText(timeText) ?? liveMatchMs;
    const team = dialog.team;
    const label = buildEventLabel(kind, team ? teamName(match, team) : "Spielabschnitt", data);
    const shared = {
      kind, team,
      player: data.player, playerName: data.playerName,
      playerIn: data.playerIn, playerInName: data.playerInName,
      playerOut: data.playerOut, playerOutName: data.playerOutName,
      durationMin: data.durationMin, text: data.text,
      matchMs: timeMs, exactTime: formatClock(timeMs), minute: displayMinute(timeMs), label,
    };

    if (dialog.mode === "edit" && dialog.event) {
      const id = dialog.event.id;
      const createdAt = dialog.event.createdAt;
      setMatch((state) => ({
        ...state,
        updatedAt: nowIso(),
        events: state.events
          .map((event) => (event.id === id ? { id, createdAt, editedAt: nowIso(), ...shared } : event))
          .sort((a, b) => a.matchMs - b.matchMs),
      }));
      flash("Ereignis aktualisiert", snapshot);
    } else {
      const event: MatchEvent = { id: uid(), createdAt: nowIso(), ...shared };
      setMatch((state) => ({ ...state, updatedAt: nowIso(), events: [...state.events, event].sort((a, b) => a.matchMs - b.matchMs) }));
      flash(`${label} gespeichert`, snapshot);
    }
    setDialog(null);
  };

  const editEvent = (event: MatchEvent) => {
    if (event.kind === "period") return;
    setDialog({ mode: "edit", action: event.kind as ActionKind, team: event.team, event });
  };

  const deleteEvent = (id: string) => {
    const snapshot = match;
    setMatch((state) => ({ ...state, updatedAt: nowIso(), events: state.events.filter((event) => event.id !== id) }));
    flash("Eintrag entfernt", snapshot);
  };

  const resetMatch = () => {
    const warning = isArchived || match.events.length === 0
      ? "Neues Spiel beginnen?"
      : "Neues Spiel beginnen? Das aktuelle Protokoll ist nicht gespeichert und wird von diesem Gerät entfernt.";
    if (!window.confirm(warning)) return;
    setMatch(createMatch());
    setNow(Date.now());
  };

  const saveCurrentMatch = () => {
    const stamped: MatchState = { ...match, runningSince: null, updatedAt: nowIso() };
    setArchive((list) => [{ savedAt: nowIso(), state: stamped }, ...list.filter((item) => item.state.id !== match.id)]
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt)));
    setDeletedIds((ids) => ids.filter((id) => id !== match.id));
    if (match.tournamentId && match.fixtureId) {
      setTournaments((list) => list.map((tournament) => tournament.id !== match.tournamentId ? tournament : {
        ...tournament,
        updatedAt: nowIso(),
        fixtures: tournament.fixtures.map((fixture) => fixture.id === match.fixtureId
          ? { ...fixture, matchId: match.id, home: fixture.home || match.homeTeam, away: fixture.away || match.awayTeam }
          : fixture),
      }));
    }
    flash(isArchived ? "Gespeichertes Spiel aktualisiert" : "Spiel gespeichert");
  };

  const openSavedMatch = (id: string) => {
    const entry = archive.find((item) => item.state.id === id);
    if (!entry) return;
    if (!isArchived && match.events.length > 0 &&
      !window.confirm("Das aktuelle Protokoll ist nicht gespeichert. Trotzdem ein gespeichertes Spiel öffnen?")) return;
    setMatch({ ...entry.state, runningSince: null });
    setNow(Date.now());
    setDialog(null);
    flash("Gespeichertes Spiel geladen");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const deleteSavedMatch = (id: string) => {
    if (!window.confirm("Dieses gespeicherte Spiel endgültig löschen? Es wird auch auf den anderen Geräten entfernt.")) return;
    setArchive((list) => list.filter((item) => item.state.id !== id));
    setDeletedIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
    flash("Gespeichertes Spiel gelöscht");
  };

  const syncNow = async () => {
    setSyncState("syncing");
    const result = await fetchTenantData(tenantId, teamId, cryptoKey);
    if (!result.ok) {
      setSyncState("error");
      flash(result.reason === "decrypt" ? "Entschlüsselung fehlgeschlagen" : "Synchronisierung fehlgeschlagen");
      return;
    }
    const merged = reconcile(result.data);
    const ok = await pushTenantData(tenantId, teamId, cryptoKey, merged);
    setSyncState(ok ? "synced" : "error");
    if (ok) setLastSyncedAt(Date.now());
    flash(ok ? "Synchronisiert" : "Synchronisierung fehlgeschlagen");
  };

  const exportAll = () => {
    downloadJson(`squora-schiri-${todayIso()}.json`, {
      app: "squora-schiedsrichter-note",
      version: 2,
      exportedAt: nowIso(),
      current: match,
      archive,
      tournaments,
    });
    flash("Daten exportiert");
  };

  const importAll = async (file: File) => {
    try {
      const data = JSON.parse(await file.text()) as { current?: unknown; archive?: unknown; tournaments?: unknown };
      const incoming = sanitizeArchive(data.archive);
      const incomingTournaments = sanitizeTournaments(data.tournaments);
      const incomingCurrent = data.current ? normalizeMatch(data.current) : null;
      if (!incoming.length && !incomingTournaments.length && !incomingCurrent) {
        flash("Keine gültigen Daten in der Datei");
        return;
      }
      const replace = incoming.length > 0 && window.confirm(
        `${incoming.length} gespeicherte(s) Spiel(e) in der Datei.\n\nOK = vorhandenes Archiv ERSETZEN\nAbbrechen = mit vorhandenem Archiv zusammenführen`,
      );
      setArchive((list) => (replace ? mergeArchives(incoming) : mergeArchives(list, incoming)));
      if (replace) setDeletedIds([]);
      if (incomingTournaments.length) setTournaments((list) => mergeTournaments(list, incomingTournaments));
      if (incomingCurrent && match.phase === "setup" && match.events.length === 0) setMatch({ ...incomingCurrent, runningSince: null });
      flash(replace ? "Archiv ersetzt" : "Daten zusammengeführt");
    } catch {
      flash("Die Datei konnte nicht gelesen werden");
    }
  };

  const startFixture = (tournament: Tournament, fixture: Fixture) => {
    if (!isArchived && match.events.length > 0 &&
      !window.confirm("Das aktuelle Protokoll ist nicht gespeichert. Neues Spiel aus der Ansetzung starten?")) return;
    setMatch(createMatch({
      homeTeam: fixture.home || "Heim",
      awayTeam: fixture.away || "Gast",
      ageGroup: tournament.ageGroup,
      halfDurationMinutes: tournament.halfDurationMinutes,
      matchDate: tournament.date || todayIso(),
      tournamentId: tournament.id,
      fixtureId: fixture.id,
    }));
    setNow(Date.now());
    flash(`Angesetzt: ${fixture.home || "Heim"} – ${fixture.away || "Gast"}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const shareReport = async () => {
    const lines = [
      `${match.homeTeam} ${homeScore} : ${awayScore} ${match.awayTeam}${match.shootout.length ? ` (n.E. ${shoot.home}:${shoot.away})` : ""}`,
      `${matchDateLabel(match)} · ${ageGroups.find((group) => group.value === match.ageGroup)?.label ?? match.ageGroup}`,
      match.meta.venue && `Ort: ${match.meta.venue}`,
      "",
      ...match.events.filter((event) => event.kind !== "period").map((event) => `${event.minute}' ${event.label}`),
    ].filter((line) => line !== undefined && line !== null) as string[];
    const text = lines.join("\n");
    try {
      if (navigator.share) {
        await navigator.share({ title: `Spielbericht ${match.homeTeam} – ${match.awayTeam}`, text });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        flash("Bericht in die Zwischenablage kopiert");
      } else {
        flash("Teilen wird von diesem Gerät nicht unterstützt");
      }
    } catch {
      /* vom Nutzer abgebrochen */
    }
  };

  const saveTeamToLibrary = (side: TeamSide) => {
    const name = (side === "home" ? match.homeTeam : match.awayTeam).trim();
    const roster = side === "home" ? match.homeRoster : match.awayRoster;
    if (!name) {
      flash("Bitte zuerst einen Mannschaftsnamen eingeben");
      return;
    }
    const existing = teams.find((team) => team.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      setTeams((list) => list.map((team) => (team.id === existing.id ? { ...team, roster, updatedAt: nowIso() } : team)));
      flash(`„${name}" in der Bibliothek aktualisiert`);
    } else {
      setTeams((list) => mergeTeams([createSavedTeam(name, "", roster)], list));
      flash(`„${name}" zur Bibliothek hinzugefügt`);
    }
  };

  /** Assign a starter to a pitch slot; vacates any slot the player previously held and bumps out whoever was there (swap-safe). */
  const assignPosition = (side: TeamSide, playerId: string, slotKey: string | null) => {
    const key = side === "home" ? "homeRoster" : "awayRoster";
    const roster = side === "home" ? match.homeRoster : match.awayRoster;
    const next = roster.map((player) => {
      if (player.id === playerId) return { ...player, position: slotKey ?? undefined };
      if (slotKey && player.position === slotKey) return { ...player, position: undefined };
      return player;
    });
    patchMatch({ [key]: next } as Partial<MatchState>);
  };

  const saveLineupToHistory = () => {
    if (match.homeRoster.length === 0) { flash("Noch keine Heim-Aufstellung vorhanden"); return; }
    const label = `Aufstellung ${match.homeTeam || "Heim"}`;
    setTeams((list) => mergeTeams([createHistoryEntry("lineup", label, match.homeRoster.map((player) => ({ ...player })), { opponent: match.awayTeam || undefined, matchDate: match.matchDate || undefined })], list));
    flash("Aufstellung in der Historie gespeichert");
  };

  const snapshotKaderToHistory = (entries: { name: string; number: string; pass: string }[]) => {
    if (entries.length === 0) return;
    const roster = entries.map((entry) => ({ id: uid(), number: entry.number, name: entry.name, pass: entry.pass, birthdate: "", status: "out" as const }));
    setTeams((list) => mergeTeams([createHistoryEntry("roster", "Kader-Stand", roster)], list));
  };

  const applyTeamFromLibrary = (side: TeamSide, teamId: string) => {
    const team = teams.find((entry) => entry.id === teamId);
    if (!team) return;
    const roster = team.roster.map((player) => ({ ...player, id: uid() }));
    if (isHistory(team)) {
      patchMatch(side === "home" ? { homeRoster: roster } : { awayRoster: roster });
      flash("Aus Historie geladen");
      return;
    }
    patchMatch(side === "home"
      ? { homeTeam: team.name || "Heim", homeRoster: roster }
      : { awayTeam: team.name || "Gast", awayRoster: roster });
    flash(`${team.name || "Team"} übernommen`);
  };

  const readDfbnetRoster = async (file: File, existing: Player[]): Promise<{ roster: Player[]; teamName: string } | null> => {
    try {
      const parsed = parseDfbnetRoster(await readCsvFile(file), file.name);
      if (parsed.players.length === 0) {
        flash("Keine Spieler in der Datei erkannt");
        return null;
      }
      const replace = existing.length === 0 || window.confirm(
        `${parsed.players.length} Spieler aus DFBnet.\n\nOK = aktuelle Aufstellung ERSETZEN\nAbbrechen = anhängen`,
      );
      const roster = replace
        ? parsed.players
        : [...existing, ...parsed.players.filter((incoming) => !existing.some((entry) => entry.name.toLowerCase() === incoming.name.toLowerCase() && entry.number === incoming.number))];
      const withoutNumbers = parsed.players.filter((player) => !player.number).length;
      flash(withoutNumbers > 0
        ? `${parsed.players.length} Spieler importiert – Rückennummern bitte ergänzen`
        : `${parsed.players.length} Spieler importiert`);
      return { roster, teamName: parsed.teamName };
    } catch {
      flash("Die CSV-Datei konnte nicht gelesen werden");
      return null;
    }
  };

  const importRosterCsv = (side: TeamSide) => async (file: File) => {
    const existing = side === "home" ? match.homeRoster : match.awayRoster;
    const result = await readDfbnetRoster(file, existing);
    if (result) patchMatch(side === "home" ? { homeRoster: result.roster } : { awayRoster: result.roster });
  };

  const phaseLabel = useMemo(() => ({
    setup: "Spielvorbereitung", firstHalf: "1. Halbzeit", halfTime: "Halbzeit",
    secondHalf: "2. Halbzeit", extraFirst: "1. HZ Verlängerung", extraBreak: "Pause Verlängerung",
    extraSecond: "2. HZ Verlängerung", shootout: "Elfmeterschießen", finished: "Beendet", abandoned: "Abgebrochen",
  })[match.phase], [match.phase]);

  const syncAgo = lastSyncedAt ? Math.max(0, Math.round((now - lastSyncedAt) / 1000)) : null;
  const syncAgoText = syncAgo === null ? "noch nicht abgeglichen"
    : syncAgo < 45 ? "gerade eben abgeglichen"
    : syncAgo < 3600 ? `abgeglichen vor ${Math.round(syncAgo / 60)} min`
    : `abgeglichen vor ${Math.round(syncAgo / 3600)} h`;

  const orderedEvents = useMemo(() => [...match.events].sort((a, b) => a.matchMs - b.matchMs).reverse(), [match.events]);

  return (
    <div className="app-shell">
      <header className="topbar no-print">
        <a className="brand" href="#top" aria-label="SQUORA Schiedsrichter Note Startseite">
          <img src={`${import.meta.env.BASE_URL}squora-logo.png`} alt="" />
          <span><strong>SQUORA</strong><small>Schiedsrichter Note</small></span>
        </a>
        <div className="topbar-actions">
          <button className="tenant-chip" onClick={() => { if (syncState === "synced" || window.confirm("Mannschaft sperren? Nicht synchronisierte Änderungen bleiben lokal auf diesem Gerät.")) onLock(); }} title="Verein / Mannschaft wechseln · sperren">
            <Icon name="shield" /> <span>{tenant.name} · {team.name}</span>
          </button>
          <button className="sound-toggle" aria-pressed={soundOn} title={soundOn ? "Signaltöne aus" : "Signaltöne an"} onClick={() => { unlockAudio(); setSoundOn((value) => !value); }}>
            <Icon name={soundOn ? "sound" : "mute"} />
          </button>
          <button className={`save-status sync-${syncState}`} onClick={syncNow} title="Jetzt synchronisieren">
            <span className="save-dot" /> <span className="save-text">{syncStatusLabel[syncState]}</span>
          </button>
          <form method="post" action={`${import.meta.env.BASE_URL}auth/logout`}>
            <button className="logout-button" aria-label="Abmelden"><Icon name="logout" /><span>Abmelden</span></button>
          </form>
        </div>
      </header>

      <main id="top">
        <section className="setup-card no-print" aria-labelledby="setup-title">
          <div className="section-heading">
            <div><span className="eyebrow">Spiel anlegen</span><h1 id="setup-title">Welche Jugend spielt heute?</h1></div>
            {match.phase !== "setup" && <button className="text-button danger-text" onClick={resetMatch}><Icon name="trash" /> Neues Spiel</button>}
          </div>
          <label className="date-field"><span>Spieldatum</span><input type="date" value={match.matchDate} onChange={(event) => patchMatch({ matchDate: event.target.value || todayIso() })} /></label>
          <div className="setup-grid">
            <label><span>Jugend</span><select value={match.ageGroup} disabled={match.phase !== "setup"} onChange={(event) => {
              const selected = ageGroups.find((group) => group.value === event.target.value)!;
              patchMatch({ ageGroup: selected.value, halfDurationMinutes: selected.minutes });
            }}>{ageGroups.map((group) => <option key={group.value} value={group.value}>{group.label}</option>)}</select></label>
            <label><span>Minuten je Halbzeit</span><div className="input-suffix"><input type="number" min="1" max="60" value={match.halfDurationMinutes} disabled={match.phase !== "setup" || !EDITABLE_DURATION_GROUPS.has(match.ageGroup)} onChange={(event) => patchMatch({ halfDurationMinutes: Number(event.target.value) || 1 })} /><em>min</em></div></label>
            <div className="rule-hint"><Icon name="clock" /><span><strong>2 × {match.halfDurationMinutes} Minuten</strong><small>Nachspielzeit läuft automatisch weiter.</small></span></div>
          </div>

          <div className="setup-extra">
            <label className="checkbox-field">
              <input type="checkbox" checked={match.knockout} disabled={match.phase !== "setup"} onChange={(event) => patchMatch({ knockout: event.target.checked })} />
              <span>K.-o.-Spiel (Verlängerung &amp; Elfmeterschießen bei Gleichstand)</span>
            </label>
            {match.knockout && (
              <label className="inline-num"><span>Verlängerung je Halbzeit</span><input type="number" min={1} max={30} value={match.extraDurationMinutes} disabled={match.phase !== "setup" && match.phase !== "secondHalf"} onChange={(event) => patchMatch({ extraDurationMinutes: Number(event.target.value) || 1 })} /><em>min</em></label>
            )}
          </div>

          {ageRules[match.ageGroup] && (
            <p className="age-rule">
              <Icon name="book" />
              <span>
                <strong>{ageRules[match.ageGroup].players}</strong> · Ball {ageRules[match.ageGroup].ball} · {ageRules[match.ageGroup].field} · Abseits: {ageRules[match.ageGroup].offside} · Wechsel: {ageRules[match.ageGroup].subs}
                <small>Richtwerte – die regionale Spielordnung gilt.</small>
              </span>
            </p>
          )}

          {teams.length > 0 && match.phase === "setup" && (
            <div className="team-picker">
              {(["home", "away"] as const).map((side) => (
                <label key={side}>
                  <span>{side === "home" ? "Heim aus Bibliothek" : "Gast aus Bibliothek"}</span>
                  <select value="" onChange={(event) => { if (event.target.value) applyTeamFromLibrary(side, event.target.value); }}>
                    <option value="">– Team wählen –</option>
                    {teams.map((team) => <option key={team.id} value={team.id}>{team.name}{team.club ? ` (${team.club})` : ""} · {team.roster.length} Sp.</option>)}
                  </select>
                </label>
              ))}
            </div>
          )}

          {match.tournamentId && <p className="tournament-tag"><Icon name="trophy" /> Teil eines Turniers – beim Speichern wird das Ergebnis in die Tabelle übernommen.</p>}
        </section>

        <section className="scoreboard" aria-label="Spielstand und Spieluhr">
          <div className="stadium-glow" />
          <div className="phase-pill"><span className={match.runningSince !== null ? "live-dot" : "idle-dot"} />{phaseLabel}</div>
          <div className="score-row">
            <div className="team team-home"><label htmlFor="home-team">Heim</label><input id="home-team" aria-label="Name der Heimmannschaft" value={match.homeTeam} maxLength={40} onChange={(event) => patchMatch({ homeTeam: event.target.value })} /></div>
            <div className="score"><strong>{homeScore}</strong><span>:</span><strong>{awayScore}</strong></div>
            <div className="team team-away"><label htmlFor="away-team">Gast</label><input id="away-team" aria-label="Name der Gastmannschaft" value={match.awayTeam} maxLength={40} onChange={(event) => patchMatch({ awayTeam: event.target.value })} /></div>
          </div>
          <div className="clock-block">
            <div className="clock-time">{formatClock(activeHalf ? periodMs : inShootout ? 0 : match.phase === "finished" || match.phase === "abandoned" ? (hadExtraTime(match) ? match.extraSecondMs : match.secondHalfMs) : inBreak ? currentPeriodMs(match, now) : match.firstHalfMs)}</div>
            {activeHalf && stoppageMs > 0 && <div className={`stoppage ${reachedStoppageTarget ? "target" : ""}`}>+ {formatClock(stoppageMs)} Nachspielzeit{match.announcedStoppageMin > 0 ? ` · Ansage +${match.announcedStoppageMin}` : ""}</div>}
            {activeHalf && match.announcedStoppageMin > 0 && stoppageMs === 0 && <div className="stoppage">Ansage: +{match.announcedStoppageMin} min · Abpfiff ab {formatClock(stoppageTargetMs)}</div>}
            {inShootout && <div className="clock-time shootout-score">{shoot.home} : {shoot.away}</div>}
            <div className="clock-subtitle">{
              match.phase === "firstHalf" ? `von ${match.halfDurationMinutes}:00 · 1. Halbzeit`
              : match.phase === "secondHalf" ? `von ${match.halfDurationMinutes}:00 · 2. Halbzeit`
              : match.phase === "extraFirst" ? `von ${match.extraDurationMinutes}:00 · 1. HZ Verlängerung`
              : match.phase === "extraSecond" ? `von ${match.extraDurationMinutes}:00 · 2. HZ Verlängerung`
              : inBreak ? "Uhr angehalten"
              : inShootout ? `${shoot.homeTaken + shoot.awayTaken} Schüsse · ${shoot.nextTeam === "home" ? match.homeTeam : match.awayTeam} ist dran`
              : match.phase === "finished" ? `Endstand${match.shootout.length ? ` · n.E. ${shoot.home}:${shoot.away}` : ""} · ${match.events.filter((event) => event.kind !== "period").length} Ereignisse`
              : match.phase === "abandoned" ? "Spiel abgebrochen"
              : `Bereit für 2 × ${match.halfDurationMinutes} Minuten`
            }</div>
          </div>

          {inBreak && match.breakStartedAt && (
            <div className={`break-timer ${breakRemainingMs <= 0 ? "over" : ""}`}>
              <Icon name="clock" /> {breakRemainingMs > 0 ? `Pause: ${formatClock(breakRemainingMs)} verbleibend` : "Pause vorbei – anpfeifen"}
            </div>
          )}

          {penalties.length > 0 && (
            <div className="pen-badges" aria-label="Laufende Zeitstrafen">
              {penalties.map((penalty) => (
                <span key={penalty.id} className={`pen-badge ${penalty.team}`}>
                  <Icon name="stopwatch" /> {penalty.team === "home" ? match.homeTeam : match.awayTeam} · {penalty.label} · {formatClock(penalty.remainingMs)}
                </span>
              ))}
            </div>
          )}

          {inShootout && (
            <div className="shootout-panel no-print">
              <div className="shootout-rows">
                {(["home", "away"] as const).map((side) => (
                  <div key={side} className={`shootout-row ${shoot.nextTeam === side && !shoot.decided ? "is-next" : ""}`}>
                    <strong>{side === "home" ? match.homeTeam : match.awayTeam}</strong>
                    <span className="shootout-dots">
                      {match.shootout.filter((attempt) => attempt.team === side).map((attempt) => (
                        <span key={attempt.id} className={attempt.scored ? "hit" : "miss"}>{attempt.scored ? "●" : "○"}</span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
              {!shoot.decided ? (
                <div className="shootout-actions">
                  <span>{shoot.nextTeam === "home" ? match.homeTeam : match.awayTeam}:</span>
                  <button className="primary-control" onClick={() => recordShootout(true)}><Icon name="ball" /> Tor</button>
                  <button className="secondary-control" onClick={() => recordShootout(false)}><Icon name="close" /> Kein Tor</button>
                  {match.shootout.length > 0 && <button className="secondary-control" onClick={undoShootout}><Icon name="undo" /> Zurück</button>}
                </div>
              ) : (
                <button className="finish-control" onClick={finishShootout}><Icon name="whistle" /> Spiel beenden · Sieg {shoot.winner === "home" ? match.homeTeam : match.awayTeam}</button>
              )}
            </div>
          )}

          <div className="clock-controls no-print">
            {match.phase === "setup" && <button className="primary-control" onClick={startMatch}><Icon name="play" /> Spiel starten</button>}
            {activeHalf && <button className="secondary-control" onClick={toggleClock}><Icon name={match.runningSince === null ? "play" : "pause"} /> {match.runningSince === null ? "Uhr fortsetzen" : "Uhr anhalten"}</button>}
            {activeHalf && <button className="secondary-control" onClick={correctClock}><Icon name="edit" /> Uhr korrigieren</button>}
            {activeHalf && <button className="secondary-control" onClick={announceStoppage}><Icon name="stopwatch" /> Nachspielzeit</button>}
            {match.phase === "firstHalf" && <button className="primary-control" disabled={!periodUnlocked} onClick={finishFirstHalf}><Icon name="whistle" /> Halbzeit</button>}
            {match.phase === "halfTime" && <button className="primary-control" onClick={startSecondHalf}><Icon name="play" /> 2. Halbzeit starten</button>}
            {match.phase === "secondHalf" && match.knockout && level && <button className="primary-control" disabled={!periodUnlocked} onClick={startExtraTime}><Icon name="play" /> Verlängerung</button>}
            {match.phase === "secondHalf" && <button className="finish-control" disabled={!periodUnlocked} onClick={finishMatch}><Icon name="whistle" /> {match.knockout && level ? "Ohne Verl. beenden" : "Spielende"}</button>}
            {match.phase === "extraFirst" && <button className="primary-control" disabled={!periodUnlocked} onClick={finishExtraFirst}><Icon name="whistle" /> Ende 1. HZ Verl.</button>}
            {match.phase === "extraBreak" && <button className="primary-control" onClick={startExtraSecond}><Icon name="play" /> 2. HZ Verl. starten</button>}
            {match.phase === "extraSecond" && <button className="finish-control" disabled={!periodUnlocked} onClick={finishExtraTime}><Icon name="whistle" /> {match.knockout && level ? "Elfmeterschießen" : "Spielende"}</button>}
            {(activeHalf || inBreak) && <button className="danger-control" onClick={abandonMatch}><Icon name="alert" /> Spielabbruch</button>}
          </div>
          {activeHalf && !periodUnlocked && <p className="unlock-note no-print">{match.phase === "firstHalf" || match.phase === "extraFirst" ? "Halbzeitpfiff" : "Abpfiff"} in {formatClock(periodTargetMs - periodMs)} verfügbar</p>}
        </section>

        <section className="actions-section no-print" aria-labelledby="actions-title">
          <div className="section-heading"><div><span className="eyebrow">Schnellerfassung</span><h2 id="actions-title">Was ist passiert?</h2></div><p>Zeitpunkt wird automatisch übernommen und ist im Dialog anpassbar.</p></div>
          <div className="team-action-grid">
            {(["home", "away"] as const).map((side) => (
              <TeamActions
                key={side}
                side={side}
                team={side === "home" ? match.homeTeam : match.awayTeam}
                subs={substitutionCount(match.events, side)}
                sanctions={sanctions(match.events, side)}
                disabled={!canRecord}
                onAction={(action) => setDialog({ mode: "create", action, team: side })}
              />
            ))}
          </div>
        </section>

        <CollapsibleSection
          id="cards"
          icon="shield"
          title="Karten & Sanktionen"
          hint="Übersicht je Spieler – die 2. Gelbe wird beim Erfassen automatisch als Feldverweis vorgeschlagen."
          badge={sanctions(match.events, "home").length + sanctions(match.events, "away").length}
          open={openPanel === "cards"}
          onToggle={() => setOpenPanel((current) => (current === "cards" ? null : "cards"))}
        >
          <div className="sanction-grid">
            {(["home", "away"] as const).map((side) => {
              const rows = sanctions(match.events, side);
              return (
                <div key={side} className="sanction-col">
                  <h4>{(side === "home" ? match.homeTeam : match.awayTeam) || (side === "home" ? "Heim" : "Gast")} · Wechsel {substitutionCount(match.events, side)}</h4>
                  {rows.length === 0 ? <p className="collapsible-hint">Keine Karten oder Zeitstrafen.</p> : (
                    <ul>
                      {rows.map((row) => (
                        <li key={row.key}>
                          <span className="sanction-player">{row.label}</span>
                          <span className="sanction-marks">
                            {row.yellow > 0 && <i className="mini-card yellow" title="Gelb" />}
                            {row.yellowRed > 0 && <i className="mini-card yellowred" title="Gelb-Rot" />}
                            {row.red > 0 && <i className="mini-card red" title="Rot" />}
                            {row.timePenalties > 0 && <span className="sanction-tp">{row.timePenalties}× Zeitstrafe</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          id="meta"
          icon="info"
          title="Spielinfos & Offizielle"
          hint="Ort, Wettbewerb, Assistenten, Wetter – erscheint im Spielbericht."
          open={openPanel === "meta"}
          onToggle={() => setOpenPanel((current) => (current === "meta" ? null : "meta"))}
        >
          <MetaPanel meta={match.meta} onChange={(patch) => patchMatch({ meta: { ...match.meta, ...patch } })} />
        </CollapsibleSection>

        <CollapsibleSection
          id="roster"
          icon="user"
          title="Mannschaftsaufstellungen"
          hint="Kader je Team, getrennt nach Aufgestellt / Bank / Nicht nominiert. Import aus DFBnet-CSV möglich; im Erfassungsdialog wird dann per Name statt Nummer gewählt."
          open={openPanel === "roster"}
          onToggle={() => setOpenPanel((current) => (current === "roster" ? null : "roster"))}
        >
          <div className="roster-editor">
            <div>
              <RosterEditor teamLabel={match.homeTeam || "Heim"} roster={match.homeRoster} grouped arrangeOnly onChange={(next) => patchMatch({ homeRoster: next })} />
              <p className="collapsible-hint">Spieler kommen aus „Mein Kader" (→ Heim-Aufstellung). Hier nur Aufgestellt / Bank / Nicht nominiert.</p>
              <PitchView
                teamLabel={match.homeTeam || "Heim"}
                roster={match.homeRoster}
                formationId={match.homeFormation}
                onFormationChange={(id) => patchMatch({ homeFormation: id })}
                onAssign={(playerId, slot) => assignPosition("home", playerId, slot)}
              />
              <button className="text-button" onClick={saveLineupToHistory}><Icon name="trophy" /> Aufstellung speichern</button>
            </div>
            <div>
              <RosterEditor teamLabel={match.awayTeam || "Gast"} roster={match.awayRoster} grouped onChange={(next) => patchMatch({ awayRoster: next })} onImportCsv={importRosterCsv("away")} />
              <PitchView
                teamLabel={match.awayTeam || "Gast"}
                roster={match.awayRoster}
                formationId={match.awayFormation}
                onFormationChange={(id) => patchMatch({ awayFormation: id })}
                onAssign={(playerId, slot) => assignPosition("away", playerId, slot)}
              />
              <button className="text-button" onClick={() => saveTeamToLibrary("away")}><Icon name="trophy" /> Gast in Bibliothek speichern</button>
            </div>
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          id="teams"
          icon="user"
          title="Team-Bibliothek"
          hint="Nur Ansicht: gespeicherte Gegner, Kader-Stände und Aufstellungen – wieder in die Aufstellung ladbar."
          badge={teams.length}
          open={openPanel === "teams"}
          onToggle={() => setOpenPanel((current) => (current === "teams" ? null : "teams"))}
        >
          <TeamLibraryPanel
            teams={teams}
            onDelete={(id) => { if (window.confirm("Eintrag aus der Bibliothek löschen?")) setTeams((list) => list.filter((team) => team.id !== id)); }}
            onClear={() => { if (window.confirm("Gesamte Team-Bibliothek löschen?")) setTeams([]); }}
            onApply={applyTeamFromLibrary}
          />
        </CollapsibleSection>

        <CollapsibleSection
          id="myroster"
          icon="user"
          title={`Mein Kader · ${team.name}`}
          hint="Server-Kader dieser Mannschaft. DFBnet-Importe laufen über den geprüften Import-Workflow."
          open={openPanel === "myroster"}
          onToggle={() => setOpenPanel((current) => (current === "myroster" ? null : "myroster"))}
        >
          <TeamRosterPanel
            clubId={tenant.id}
            teamId={team.id}
            teamName={team.name}
            onCopyToLibrary={snapshotKaderToHistory}
            onCopyToLineup={(side, entries) => {
              const roster = entries.map((entry) => ({ id: uid(), number: entry.number, name: entry.name, pass: entry.pass, birthdate: "", status: "out" as const }));
              patchMatch(side === "home"
                ? { homeTeam: match.homeTeam || team.name, homeRoster: roster }
                : { awayTeam: match.awayTeam || team.name, awayRoster: roster });
            }}
            onSnapshot={snapshotKaderToHistory}
          />
        </CollapsibleSection>

        <section className="log-card" aria-labelledby="log-title">
          <div className="section-heading">
            <button className="log-toggle no-print" aria-expanded={showLog} onClick={() => setShowLog((value) => !value)}>
              <span className="eyebrow">Digitale Spielnotiz</span>
              <h2 id="log-title"><Icon name="list" /> Spielereignisse <span className="count">{match.events.length}</span></h2>
              <span className={`chevron ${showLog ? "up" : ""}`}><Icon name="play" /></span>
            </button>
            <div className="log-tools no-print">
              <button className="icon-button" onClick={() => setDialog({ mode: "create", action: "note" })}><Icon name="alert" /> Vorkommnis</button>
              <button className="icon-button" onClick={saveCurrentMatch} disabled={!match.events.length}><Icon name="check" /> {isArchived ? "Aktualisieren" : "Speichern"}</button>
              <button className="icon-button" onClick={() => void shareReport()} disabled={!match.events.length}><Icon name="share" /> Teilen</button>
              <button className="icon-button" onClick={exportCsv} disabled={!match.events.length}><Icon name="download" /> CSV</button>
              <button className="icon-button" onClick={() => setPrintTarget(match)} disabled={!match.events.length}><Icon name="print" /> Drucken</button>
            </div>
          </div>

          {!showLog ? null : match.events.length === 0 ? <div className="empty-log"><Icon name="whistle" /><strong>Noch keine Spielereignisse</strong><span>Sobald das Spiel startet, erscheint hier der erste Eintrag.</span></div> :
            <div className="table-scroll">
              <table className="event-table">
                <thead>
                  <tr>
                    <th>Datum</th><th>Uhrzeit</th><th>Spielzeit</th><th>Min.</th><th>Ereignis</th><th>Mannschaft</th><th className="no-print" aria-label="Aktionen" />
                  </tr>
                </thead>
                <tbody>
                  {orderedEvents.map((event) => (
                    <tr key={event.id} className={`row-${event.kind}`}>
                      <td>{formatDate(event.createdAt)}</td>
                      <td className="num">{formatWallClock(event.createdAt)}</td>
                      <td className="num">{event.exactTime}</td>
                      <td className="num">{event.minute}&prime;</td>
                      <td>{event.label}{event.editedAt ? <span className="edited-tag"> · bearb.</span> : null}</td>
                      <td>{event.team === "home" ? match.homeTeam : event.team === "away" ? match.awayTeam : "Spielabschnitt"}</td>
                      <td className="no-print event-actions">
                        {event.kind !== "period" && <>
                          <button className="mini-icon" aria-label={`${event.label} bearbeiten`} title="Bearbeiten" onClick={() => editEvent(event)}><Icon name="edit" /></button>
                          <button className="mini-icon danger" aria-label={`${event.label} löschen`} title="Löschen" onClick={() => deleteEvent(event.id)}><Icon name="trash" /></button>
                        </>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>}

          {printTarget && !printTournament && <MatchReport state={printTarget} />}
          {printTournament && <TournamentReport tournament={printTournament} archive={archive} />}
        </section>

        <section className="log-card archive-card no-print" aria-labelledby="archive-title">
          <div className="section-heading">
            <div><span className="eyebrow">Archiv &amp; Sync</span><h2 id="archive-title"><Icon name="list" /> Gespeicherte Spiele <span className="count">{archive.length}</span></h2></div>
            <div className="log-tools">
              <button className="icon-button" onClick={syncNow}><Icon name="refresh" /> Jetzt synchronisieren</button>
              <button className="icon-button" onClick={exportAll} disabled={!archive.length && !match.events.length && !tournaments.length}><Icon name="download" /> Exportieren</button>
              <button className="icon-button" onClick={() => fileInput.current?.click()}><Icon name="upload" /> Importieren</button>
              <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importAll(file);
                event.target.value = "";
              }} />
            </div>
          </div>
          <p className="archive-hint">{syncStatusLabel[syncState]} · {syncAgoText}. Gespeicherte Spiele und Turniere erscheinen auf jedem angemeldeten Gerät; Export/Import dient als Backup und zur Weitergabe.</p>
          {archive.length === 0 ? <div className="empty-log"><Icon name="list" /><strong>Noch keine gespeicherten Spiele</strong><span>Tippe im Protokoll auf „Speichern“, um ein Spiel hier abzulegen.</span></div> :
            <div className="table-scroll">
              <table className="archive-table">
                <thead>
                  <tr><th>Spieldatum</th><th>Gespeichert</th><th>Begegnung</th><th>Ergebnis</th><th>Jugend</th><th>Ereignisse</th><th aria-label="Aktionen" /></tr>
                </thead>
                <tbody>
                  {archive.map((entry) => {
                    const saved = entry.state;
                    const isOpen = saved.id === match.id;
                    return (
                      <tr key={saved.id} className={isOpen ? "row-open" : undefined}>
                        <td>{matchDateLabel(saved)}</td>
                        <td className="num">{formatDate(entry.savedAt)} · {formatWallClock(entry.savedAt)}</td>
                        <td>{saved.homeTeam} – {saved.awayTeam}{saved.phase === "abandoned" ? " (Abbr.)" : ""}</td>
                        <td className="num">{score(saved.events, "home")} : {score(saved.events, "away")}</td>
                        <td>{ageGroups.find((group) => group.value === saved.ageGroup)?.label ?? "–"}</td>
                        <td className="num">{saved.events.filter((event) => event.kind !== "period").length}</td>
                        <td className="archive-actions">
                          <button className="text-button" onClick={() => openSavedMatch(saved.id)} disabled={isOpen}>{isOpen ? "Geöffnet" : "Öffnen"}</button>
                          <button className="text-button" onClick={() => setPrintTarget(saved)} title="Als PDF drucken"><Icon name="print" /></button>
                          <button className="text-button danger-text" onClick={() => deleteSavedMatch(saved.id)} aria-label="Gespeichertes Spiel löschen"><Icon name="trash" /></button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>}
        </section>

        <CollapsibleSection
          id="tournaments"
          icon="trophy"
          title="Turniere"
          hint="Spielplan, Ergebnisse und automatische Tabelle – als ganzes PDF druckbar."
          badge={tournaments.length}
          open={openPanel === "tournaments"}
          onToggle={() => setOpenPanel((current) => (current === "tournaments" ? null : "tournaments"))}
        >
          <TournamentPanel
            tournaments={tournaments}
            archive={archive}
            onCreate={() => {
              const name = window.prompt("Name des Turniers:", "");
              if (name === null) return;
              setTournaments((list) => [createTournament(name.trim(), todayIso()), ...list]);
            }}
            onUpdate={(id, patch) => setTournaments((list) => list.map((tournament) => tournament.id === id ? { ...tournament, ...patch, updatedAt: nowIso() } : tournament))}
            onDelete={(id) => {
              if (!window.confirm("Turnier löschen? Gespeicherte Spiele bleiben im Archiv erhalten.")) return;
              setTournaments((list) => list.filter((tournament) => tournament.id !== id));
            }}
            onStartFixture={startFixture}
            onExportOne={(tournament) => downloadJson(`turnier-${(tournament.name || "squora").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`, { app: "squora-schiedsrichter-note", kind: "tournament", version: 2, tournament })}
            onPrint={setPrintTournament}
          />
        </CollapsibleSection>

        <CollapsibleSection
          id="stats"
          icon="chart"
          title="Saison-Statistik"
          hint="Auswertung aus dem Archiv für einen Zeitraum – als CSV exportierbar."
          open={openPanel === "stats"}
          onToggle={() => setOpenPanel((current) => (current === "stats" ? null : "stats"))}
        >
          <StatsPanel
            archive={archive}
            range={statsRange}
            onRange={(patch) => setStatsRange((current) => ({ ...current, ...patch }))}
            onExport={() => {
              const rows = statsCsvRows(archive, statsRange.from, statsRange.to);
              downloadBlob(`squora-statistik-${statsRange.from}_${statsRange.to}.csv`, new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }));
            }}
          />
        </CollapsibleSection>

        <p className="privacy-note no-print">Der Server prüft deine Vereinsmitgliedschaft bei jedem Zugriff. Offline-Daten werden ausschließlich AES-256-GCM-verschlüsselt in IndexedDB gespeichert; die Cache-Passphrase und der Schlüssel bleiben im Arbeitsspeicher dieses Browsers.</p>
      </main>

      {dialog && (
        <EventDialog
          request={dialog}
          teamLabel={dialog.team ? teamName(match, dialog.team) : "Spiel"}
          roster={dialog.team === "home" ? match.homeRoster : dialog.team === "away" ? match.awayRoster : []}
          defaultTimeText={formatClock(liveMatchMs)}
          hasPriorYellow={dialog.team ? (player) => hasPriorYellow(match.events, dialog.team as TeamSide, player) : undefined}
          onClose={() => setDialog(null)}
          onSave={handleDialogSave}
        />
      )}
      {notice && (
        <div className="toast" role="status">
          <Icon name="check" />{notice.text}
          {notice.undo && <button className="toast-undo" onClick={() => { setMatch(notice.undo!); setNotice(null); }}><Icon name="undo" /> Rückgängig</button>}
        </div>
      )}
      {sessionExpired && <SessionExpiredModal baseUrl={import.meta.env.BASE_URL} />}
    </div>
  );

  function exportCsv() {
    const rows = [
      ["Datum", "Uhrzeit", "Spielzeit", "Minute", "Ereignis", "Mannschaft", "Spieler", "Raus", "Rein", "Dauer (min)"],
      ...[...match.events].sort((a, b) => a.matchMs - b.matchMs).map((event) => [
        formatDate(event.createdAt), formatWallClock(event.createdAt), event.exactTime, String(event.minute), event.label,
        event.team === "home" ? match.homeTeam : event.team === "away" ? match.awayTeam : "",
        event.playerName ? `${event.player} ${event.playerName}` : event.player ?? "",
        event.playerOutName ? `${event.playerOut} ${event.playerOutName}` : event.playerOut ?? "",
        event.playerInName ? `${event.playerIn} ${event.playerInName}` : event.playerIn ?? "",
        event.durationMin ? String(event.durationMin) : "",
      ]),
    ];
    downloadBlob(`spielbericht-${match.homeTeam}-${match.awayTeam}.csv`.replace(/[^a-z0-9äöüß.-]+/gi, "-").toLowerCase(),
      new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }));
  }
}

function readActiveTenant(): string | null {
  try {
    return localStorage.getItem(ACTIVE_TENANT_KEY);
  } catch {
    return null;
  }
}

function Root() {
  const [unlocked, setUnlocked] = useState<{ userId: string; tenant: TenantMeta; team: TeamUnit; key: CryptoKey | null } | null>(null);

  if (!unlocked) {
    return (
      <TenantGate
        rememberedId={readActiveTenant()}
        onUnlock={(userId, tenant, team, key) => {
          try {
            localStorage.setItem(ACTIVE_TENANT_KEY, scopeKey(userId, tenant.id, team.id));
          } catch {
            /* ignore */
          }
          setUnlocked({ userId, tenant, team, key });
        }}
      />
    );
  }

  return (
    <App
      key={scopeKey(unlocked.userId, unlocked.tenant.id, unlocked.team.id)}
      userId={unlocked.userId}
      tenant={unlocked.tenant}
      team={unlocked.team}
      cryptoKey={unlocked.key}
      onLock={() => setUnlocked(null)}
    />
  );
}

export default Root;
