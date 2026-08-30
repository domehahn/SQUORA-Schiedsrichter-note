import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./icons";
import {
  ageGroups,
  currentHalfMs,
  displayMinute,
  formatClock,
  initialMatch,
  matchTimeMs,
  regulationMs,
  score,
  type EventKind,
  type MatchEvent,
  type MatchState,
  type TeamSide,
} from "./match";

const STORAGE_KEY = "squora-referee-note-match-v1";
type DialogAction = Exclude<EventKind, "period">;
type DialogState = { action: DialogAction; team: TeamSide } | null;

function loadMatch(): MatchState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return initialMatch;
    const parsed = JSON.parse(saved) as MatchState;
    return parsed.version === 1 ? parsed : initialMatch;
  } catch {
    return initialMatch;
  }
}

function App() {
  const [match, setMatch] = useState<MatchState>(loadMatch);
  const [now, setNow] = useState(Date.now());
  const [dialog, setDialog] = useState<DialogState>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(match));
  }, [match]);

  useEffect(() => {
    if (match.runningSince === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [match.runningSince]);

  const periodMs = regulationMs(match);
  const halfMs = currentHalfMs(match, now);
  const activeHalf = match.phase === "firstHalf" || match.phase === "secondHalf";
  const canRecord = activeHalf;
  const homeScore = score(match.events, "home");
  const awayScore = score(match.events, "away");
  const stoppageMs = Math.max(0, halfMs - periodMs);

  const flash = (message: string) => {
    setNotice(message);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 2600);
  };

  const freezeClock = (state: MatchState, timestamp: number): MatchState => {
    if (state.runningSince === null) return state;
    const elapsed = Math.max(0, timestamp - state.runningSince);
    return state.phase === "secondHalf"
      ? { ...state, secondHalfMs: state.secondHalfMs + elapsed, runningSince: null }
      : { ...state, firstHalfMs: state.firstHalfMs + elapsed, runningSince: null };
  };

  const addPeriodEvent = (state: MatchState, label: string, timestamp: number): MatchState => {
    const timeMs = matchTimeMs(state, timestamp);
    const event: MatchEvent = {
      id: crypto.randomUUID(), kind: "period", matchMs: timeMs, exactTime: formatClock(timeMs),
      minute: displayMinute(timeMs), label, createdAt: new Date().toISOString(),
    };
    return { ...state, events: [...state.events, event] };
  };

  const startMatch = () => {
    const timestamp = Date.now();
    setNow(timestamp);
    setMatch((state) => addPeriodEvent({ ...state, phase: "firstHalf", runningSince: timestamp, startedAt: new Date(timestamp).toISOString() }, "Anpfiff · 1. Halbzeit", timestamp));
  };

  const toggleClock = () => {
    const timestamp = Date.now();
    setNow(timestamp);
    setMatch((state) => state.runningSince === null ? { ...state, runningSince: timestamp } : freezeClock(state, timestamp));
  };

  const finishFirstHalf = () => {
    if (halfMs < periodMs) return;
    const timestamp = Date.now();
    setNow(timestamp);
    setMatch((state) => {
      const frozen = freezeClock(state, timestamp);
      return { ...addPeriodEvent(frozen, "Halbzeit", timestamp), phase: "halfTime" };
    });
    flash("Halbzeit gespeichert");
  };

  const startSecondHalf = () => {
    const timestamp = Date.now();
    setNow(timestamp);
    setMatch((state) => addPeriodEvent({ ...state, phase: "secondHalf", runningSince: timestamp }, "Anpfiff · 2. Halbzeit", timestamp));
  };

  const finishMatch = () => {
    if (halfMs < periodMs) return;
    const timestamp = Date.now();
    setNow(timestamp);
    setMatch((state) => {
      const frozen = freezeClock(state, timestamp);
      return { ...addPeriodEvent(frozen, "Spielende", timestamp), phase: "finished", finishedAt: new Date(timestamp).toISOString() };
    });
    flash("Spielbericht ist abgeschlossen");
  };

  const saveEvent = (data: { player?: string; playerIn?: string; playerOut?: string }) => {
    if (!dialog) return;
    const timestamp = Date.now();
    const timeMs = matchTimeMs(match, timestamp);
    const teamName = dialog.team === "home" ? match.homeTeam : match.awayTeam;
    const labels: Record<DialogAction, string> = {
      goal: `Tor ${teamName} · Nr. ${data.player}`,
      substitution: `Wechsel ${teamName} · Nr. ${data.playerOut} raus, Nr. ${data.playerIn} rein`,
      yellow: `Gelbe Karte ${teamName} · Nr. ${data.player}`,
      red: `Rote Karte ${teamName} · Nr. ${data.player}`,
    };
    const event: MatchEvent = {
      id: crypto.randomUUID(), kind: dialog.action, team: dialog.team, ...data,
      matchMs: timeMs, exactTime: formatClock(timeMs), minute: displayMinute(timeMs),
      label: labels[dialog.action], createdAt: new Date().toISOString(),
    };
    setMatch((state) => ({ ...state, events: [...state.events, event] }));
    setDialog(null);
    flash(`${labels[dialog.action]} gespeichert`);
  };

  const deleteEvent = (id: string) => {
    setMatch((state) => ({ ...state, events: state.events.filter((event) => event.id !== id) }));
    flash("Eintrag entfernt");
  };

  const resetMatch = () => {
    if (!window.confirm("Neues Spiel beginnen? Das aktuelle Protokoll wird auf diesem Gerät gelöscht.")) return;
    setMatch(initialMatch);
    setNow(Date.now());
  };

  const exportCsv = () => {
    const rows = [
      ["Spielzeit", "Minute", "Ereignis", "Mannschaft", "Spieler", "Raus", "Rein"],
      ...match.events.map((event) => [event.exactTime, String(event.minute), event.label, event.team === "home" ? match.homeTeam : event.team === "away" ? match.awayTeam : "", event.player ?? "", event.playerOut ?? "", event.playerIn ?? ""]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(";")).join("\r\n");
    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `spielbericht-${match.homeTeam}-${match.awayTeam}.csv`.replace(/[^a-z0-9äöüß.-]+/gi, "-").toLowerCase();
    link.click();
    URL.revokeObjectURL(url);
  };

  const phaseLabel = useMemo(() => ({ setup: "Spielvorbereitung", firstHalf: "1. Halbzeit", halfTime: "Halbzeit", secondHalf: "2. Halbzeit", finished: "Beendet" })[match.phase], [match.phase]);

  return (
    <div className="app-shell">
      <header className="topbar no-print">
        <a className="brand" href="#top" aria-label="SQUORA Schiedsrichter Note Startseite">
          <img src="/squora-logo.png" alt="" />
          <span><strong>SQUORA</strong><small>Schiedsrichter Note</small></span>
        </a>
        <div className="save-status"><span className="save-dot" /> Auf diesem Gerät gespeichert</div>
      </header>

      <main id="top">
        <section className="setup-card no-print" aria-labelledby="setup-title">
          <div className="section-heading">
            <div><span className="eyebrow">Spiel anlegen</span><h1 id="setup-title">Welche Jugend spielt heute?</h1></div>
            {match.phase !== "setup" && <button className="text-button danger-text" onClick={resetMatch}><Icon name="trash" /> Neues Spiel</button>}
          </div>
          <div className="setup-grid">
            <label><span>Jugend</span><select value={match.ageGroup} disabled={match.phase !== "setup"} onChange={(event) => {
              const selected = ageGroups.find((group) => group.value === event.target.value)!;
              setMatch((state) => ({ ...state, ageGroup: selected.value, halfDurationMinutes: selected.minutes }));
            }}>{ageGroups.map((group) => <option key={group.value} value={group.value}>{group.label}</option>)}</select></label>
            <label><span>Minuten je Halbzeit</span><div className="input-suffix"><input type="number" min="1" max="60" value={match.halfDurationMinutes} disabled={match.phase !== "setup" || match.ageGroup !== "custom"} onChange={(event) => setMatch((state) => ({ ...state, halfDurationMinutes: Number(event.target.value) || 1 }))}/><em>min</em></div></label>
            <div className="rule-hint"><Icon name="clock" /><span><strong>2 × {match.halfDurationMinutes} Minuten</strong><small>Nachspielzeit läuft automatisch weiter.</small></span></div>
          </div>
        </section>

        <section className="scoreboard" aria-label="Spielstand und Spieluhr">
          <div className="stadium-glow" />
          <div className="phase-pill"><span className={match.runningSince !== null ? "live-dot" : "idle-dot"}/>{phaseLabel}</div>
          <div className="score-row">
            <div className="team team-home"><label htmlFor="home-team">Heim</label><input id="home-team" aria-label="Name der Heimmannschaft" value={match.homeTeam} maxLength={40} onChange={(event) => setMatch((state) => ({ ...state, homeTeam: event.target.value }))}/></div>
            <div className="score"><strong>{homeScore}</strong><span>:</span><strong>{awayScore}</strong></div>
            <div className="team team-away"><label htmlFor="away-team">Gast</label><input id="away-team" aria-label="Name der Gastmannschaft" value={match.awayTeam} maxLength={40} onChange={(event) => setMatch((state) => ({ ...state, awayTeam: event.target.value }))}/></div>
          </div>
          <div className="clock-block">
            <div className="clock-time">{formatClock(activeHalf ? halfMs : match.phase === "finished" ? match.secondHalfMs : match.firstHalfMs)}</div>
            {activeHalf && stoppageMs > 0 && <div className="stoppage">+ {formatClock(stoppageMs)} Nachspielzeit</div>}
            <div className="clock-subtitle">{match.phase === "firstHalf" ? `von ${match.halfDurationMinutes}:00 · 1. Halbzeit` : match.phase === "secondHalf" ? `von ${match.halfDurationMinutes}:00 · 2. Halbzeit` : match.phase === "halfTime" ? "Uhr angehalten" : match.phase === "finished" ? `Endstand · ${match.events.filter((event) => event.kind !== "period").length} Ereignisse` : `Bereit für 2 × ${match.halfDurationMinutes} Minuten`}</div>
          </div>
          <div className="clock-controls no-print">
            {match.phase === "setup" && <button className="primary-control" onClick={startMatch}><Icon name="play" /> Spiel starten</button>}
            {activeHalf && <button className="secondary-control" onClick={toggleClock}><Icon name={match.runningSince === null ? "play" : "pause"} /> {match.runningSince === null ? "Uhr fortsetzen" : "Uhr anhalten"}</button>}
            {match.phase === "firstHalf" && <button className="primary-control" disabled={halfMs < periodMs} onClick={finishFirstHalf}><Icon name="whistle" /> Halbzeit</button>}
            {match.phase === "halfTime" && <button className="primary-control" onClick={startSecondHalf}><Icon name="play" /> 2. Halbzeit starten</button>}
            {match.phase === "secondHalf" && <button className="finish-control" disabled={halfMs < periodMs} onClick={finishMatch}><Icon name="whistle" /> Spielende</button>}
          </div>
          {activeHalf && halfMs < periodMs && <p className="unlock-note no-print">{match.phase === "firstHalf" ? "Halbzeit" : "Spielende"} in {formatClock(periodMs - halfMs)} verfügbar</p>}
        </section>

        <section className="actions-section no-print" aria-labelledby="actions-title">
          <div className="section-heading"><div><span className="eyebrow">Schnellerfassung</span><h2 id="actions-title">Was ist passiert?</h2></div><p>Die exakte Spielzeit wird automatisch übernommen.</p></div>
          <div className="team-action-grid">
            <TeamActions side="home" team={match.homeTeam} disabled={!canRecord} onAction={(action) => setDialog({ action, team: "home" })}/>
            <TeamActions side="away" team={match.awayTeam} disabled={!canRecord} onAction={(action) => setDialog({ action, team: "away" })}/>
          </div>
        </section>

        <section className="log-card" aria-labelledby="log-title">
          <div className="section-heading">
            <div><span className="eyebrow">Digitale Spielnotiz</span><h2 id="log-title"><Icon name="list" /> Spielereignisse <span className="count">{match.events.length}</span></h2></div>
            <div className="log-tools no-print"><button className="icon-button" onClick={exportCsv} disabled={!match.events.length}><Icon name="download"/> CSV</button><button className="icon-button" onClick={() => window.print()} disabled={!match.events.length}><Icon name="print"/> Drucken</button></div>
          </div>
          <div className="print-summary"><strong>{match.homeTeam} {homeScore} : {awayScore} {match.awayTeam}</strong><span>{ageGroups.find((group) => group.value === match.ageGroup)?.label} · 2 × {match.halfDurationMinutes} Minuten</span></div>
          {match.events.length === 0 ? <div className="empty-log"><Icon name="whistle"/><strong>Noch keine Spielereignisse</strong><span>Sobald das Spiel startet, erscheint hier der erste Eintrag.</span></div> :
            <ol className="event-list">{[...match.events].reverse().map((event) => <li key={event.id} className={`event event-${event.kind}`}>
              <div className="event-time"><strong>{event.minute}&prime;</strong><span>{event.exactTime}</span></div>
              <span className="event-icon">{event.kind === "goal" ? <Icon name="ball"/> : event.kind === "substitution" ? <Icon name="swap"/> : event.kind === "period" ? <Icon name="whistle"/> : <span className={`mini-card ${event.kind}`}/>}</span>
              <div className="event-copy"><strong>{event.label}</strong><span>{event.team === "home" ? "Heimmannschaft" : event.team === "away" ? "Gastmannschaft" : "Spielabschnitt"}</span></div>
              {event.kind !== "period" && <button className="delete-event no-print" aria-label={`${event.label} löschen`} title="Eintrag löschen" onClick={() => deleteEvent(event.id)}><Icon name="trash"/></button>}
            </li>)}</ol>}
        </section>
        <p className="privacy-note no-print">Alle Daten bleiben lokal in diesem Browser. Bitte exportiere den Bericht, bevor du Browserdaten löschst oder das Gerät wechselst.</p>
      </main>

      {dialog && <EventDialog dialog={dialog} team={dialog.team === "home" ? match.homeTeam : match.awayTeam} currentTime={formatClock(matchTimeMs(match, Date.now()))} onClose={() => setDialog(null)} onSave={saveEvent}/>}
      {notice && <div className="toast" role="status"><Icon name="check"/>{notice}</div>}
    </div>
  );
}

function TeamActions({ side, team, disabled, onAction }: { side: TeamSide; team: string; disabled: boolean; onAction: (action: DialogAction) => void }) {
  return <div className={`team-actions ${side}`}>
    <div className="team-actions-title"><span>{side === "home" ? "Heim" : "Gast"}</span><strong>{team || (side === "home" ? "Heimmannschaft" : "Gastmannschaft")}</strong></div>
    <div className="action-buttons">
      <button className="action-goal" disabled={disabled} onClick={() => onAction("goal")}><span className="action-icon"><Icon name="ball"/></span><span><strong>Tor</strong><small>Rückennummer</small></span></button>
      <button className="action-sub" disabled={disabled} onClick={() => onAction("substitution")}><span className="action-icon"><Icon name="swap"/></span><span><strong>Wechsel</strong><small>Raus & rein</small></span></button>
      <button className="action-yellow" disabled={disabled} onClick={() => onAction("yellow")}><span className="action-icon"><span className="large-card yellow"/></span><span><strong>Gelb</strong><small>Rückennummer</small></span></button>
      <button className="action-red" disabled={disabled} onClick={() => onAction("red")}><span className="action-icon"><span className="large-card red"/></span><span><strong>Rot</strong><small>Rückennummer</small></span></button>
    </div>
  </div>;
}

function EventDialog({ dialog, team, currentTime, onClose, onSave }: { dialog: NonNullable<DialogState>; team: string; currentTime: string; onClose: () => void; onSave: (data: { player?: string; playerIn?: string; playerOut?: string }) => void }) {
  const [player, setPlayer] = useState("");
  const [playerOut, setPlayerOut] = useState("");
  const [playerIn, setPlayerIn] = useState("");
  const firstInput = useRef<HTMLInputElement>(null);
  useEffect(() => firstInput.current?.focus(), []);
  const titles = { goal: "Tor eintragen", substitution: "Wechsel eintragen", yellow: "Gelbe Karte", red: "Rote Karte" };
  const valid = dialog.action === "substitution" ? Boolean(playerOut.trim() && playerIn.trim()) : Boolean(player.trim());
  const submit = (event: React.FormEvent) => { event.preventDefault(); if (valid) onSave(dialog.action === "substitution" ? { playerOut: playerOut.trim(), playerIn: playerIn.trim() } : { player: player.trim() }); };
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
      <button className="modal-close" onClick={onClose} aria-label="Dialog schließen"><Icon name="close"/></button>
      <span className={`modal-symbol ${dialog.action}`}>
        {dialog.action === "goal" ? <Icon name="ball"/> : dialog.action === "substitution" ? <Icon name="swap"/> : <span className={`large-card ${dialog.action}`}/>}</span>
      <div className="dialog-kicker">{team} · {currentTime}</div><h2 id="dialog-title">{titles[dialog.action]}</h2>
      <form onSubmit={submit}>
        {dialog.action === "substitution" ? <div className="sub-fields">
          <label><span>Rückennummer raus</span><input ref={firstInput} inputMode="numeric" pattern="[0-9A-Za-z-]+" maxLength={4} value={playerOut} onChange={(e) => setPlayerOut(e.target.value)} placeholder="z. B. 8"/><small><i className="out-arrow">↓</i> verlässt das Feld</small></label>
          <label><span>Rückennummer rein</span><input inputMode="numeric" pattern="[0-9A-Za-z-]+" maxLength={4} value={playerIn} onChange={(e) => setPlayerIn(e.target.value)} placeholder="z. B. 14"/><small><i className="in-arrow">↑</i> betritt das Feld</small></label>
        </div> : <label className="player-field"><span>Rückennummer</span><input ref={firstInput} inputMode="numeric" pattern="[0-9A-Za-z-]+" maxLength={4} value={player} onChange={(e) => setPlayer(e.target.value)} placeholder="z. B. 10"/><small>Die Spielzeit {currentTime} wird automatisch gespeichert.</small></label>}
        <div className="modal-actions"><button type="button" className="cancel-button" onClick={onClose}>Abbrechen</button><button className="save-button" disabled={!valid}><Icon name="check"/> Ereignis speichern</button></div>
      </form>
    </div>
  </div>;
}

export default App;
