import {
  ageGroups,
  formatDate,
  formatWallClock,
  hadExtraTime,
  matchDateLabel,
  score,
  shootoutTally,
  type MatchState,
} from "./match";

const phaseText: Record<MatchState["phase"], string> = {
  setup: "Vorbereitung",
  firstHalf: "1. Halbzeit",
  halfTime: "Halbzeit",
  secondHalf: "2. Halbzeit",
  extraFirst: "1. Halbzeit Verlängerung",
  extraBreak: "Pause Verlängerung",
  extraSecond: "2. Halbzeit Verlängerung",
  shootout: "Elfmeterschießen",
  finished: "Beendet",
  abandoned: "Abgebrochen",
};

function MetaLine({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return <span><b>{label}:</b> {value}</span>;
}

export function MatchReport({ state, className = "" }: { state: MatchState; className?: string }) {
  const home = score(state.events, "home");
  const away = score(state.events, "away");
  const shootout = state.shootout.length > 0 ? shootoutTally(state.shootout) : null;
  const ageLabel = ageGroups.find((group) => group.value === state.ageGroup)?.label ?? state.ageGroup;
  const meta = state.meta;
  const officials = [
    meta.referee && `SR ${meta.referee}`,
    meta.assistant1 && `SRA1 ${meta.assistant1}`,
    meta.assistant2 && `SRA2 ${meta.assistant2}`,
    meta.fourthOfficial && `4. Off. ${meta.fourthOfficial}`,
  ].filter(Boolean).join(" · ");

  return (
    <div className={`match-report ${className}`}>
      <div className="report-brand">SQUORA · Schiedsrichter Note</div>
      <h3>Spielbericht{state.phase === "abandoned" ? " (Spielabbruch)" : ""}</h3>

      <div className="report-score">
        <span>{state.homeTeam}</span>
        <strong>{home} : {away}</strong>
        <span>{state.awayTeam}</span>
      </div>
      {shootout && (
        <div className="report-meta">
          <MetaLine label="Elfmeterschießen" value={`${shootout.home} : ${shootout.away}${shootout.winner ? ` – Sieg ${shootout.winner === "home" ? state.homeTeam : state.awayTeam}` : ""}`} />
        </div>
      )}

      <div className="report-meta">
        <MetaLine label="Datum" value={matchDateLabel(state)} />
        <MetaLine label="Anpfiff" value={state.startedAt ? `${formatWallClock(state.startedAt)} Uhr` : ""} />
        <MetaLine label="Abpfiff" value={state.finishedAt ? `${formatWallClock(state.finishedAt)} Uhr` : ""} />
        <MetaLine label="Altersklasse" value={`${ageLabel} · 2 × ${state.halfDurationMinutes} Min.${hadExtraTime(state) ? ` + 2 × ${state.extraDurationMinutes} Min. Verl.` : ""}`} />
        <MetaLine label="Status" value={phaseText[state.phase]} />
        <MetaLine label="Wettbewerb" value={[meta.competition, meta.matchday && `Sp. ${meta.matchday}`].filter(Boolean).join(" · ")} />
        <MetaLine label="Ort" value={meta.venue} />
        <MetaLine label="Zuschauer" value={meta.spectators} />
        <MetaLine label="Wetter/Platz" value={[meta.weather, meta.pitch].filter(Boolean).join(" · ")} />
        <MetaLine label="Anstoßverzögerung" value={meta.kickoffDelay} />
        <MetaLine label="Offizielle" value={officials} />
        <MetaLine label="Abbruchgrund" value={meta.abandonedReason} />
      </div>

      {(state.homeRoster.length > 0 || state.awayRoster.length > 0) && (
        <div className="report-rosters">
          {(["home", "away"] as const).map((side) => {
            const roster = side === "home" ? state.homeRoster : state.awayRoster;
            if (!roster.length) return null;
            return (
              <div key={side}>
                <h4>{side === "home" ? state.homeTeam : state.awayTeam}</h4>
                <p>{roster.map((player) => `${player.number}${player.name ? ` ${player.name}` : ""}`).join(" · ")}</p>
              </div>
            );
          })}
        </div>
      )}

      <table className="report-table">
        <thead>
          <tr><th>Datum</th><th>Uhrzeit</th><th>Spielzeit</th><th>Min.</th><th>Ereignis</th><th>Mannschaft</th></tr>
        </thead>
        <tbody>
          {state.events.length === 0 ? (
            <tr><td colSpan={6}>Keine Ereignisse erfasst.</td></tr>
          ) : (
            state.events.map((event) => (
              <tr key={event.id} className={`row-${event.kind}`}>
                <td>{formatDate(event.createdAt)}</td>
                <td className="num">{formatWallClock(event.createdAt)}</td>
                <td className="num">{event.exactTime}</td>
                <td className="num">{event.minute}&prime;</td>
                <td>{event.label}{event.editedAt ? " (nachträglich bearbeitet)" : ""}</td>
                <td>{event.team === "home" ? state.homeTeam : event.team === "away" ? state.awayTeam : "Spielabschnitt"}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {meta.incidents && (
        <div className="report-incidents">
          <h4>Besondere Vorkommnisse</h4>
          <p>{meta.incidents}</p>
        </div>
      )}

      <div className="report-signatures">
        <div><span /> Unterschrift Schiedsrichter/in</div>
        <div><span /> Ort, Datum</div>
      </div>
    </div>
  );
}
