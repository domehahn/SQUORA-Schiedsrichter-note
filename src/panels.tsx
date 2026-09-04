import { useMemo, useRef, useState } from "react";
import { Icon } from "./icons";
import { RosterEditor } from "./RosterEditor";
import { ageGroups, formatDate, score, type SavedMatch, type TeamSide } from "./match";
import { createFixture, standings, type Fixture, type Tournament } from "./tournament";
import { type SavedTeam } from "./teams";
import { seasonStats } from "./stats";

export function TournamentPanel({ tournaments, archive, onCreate, onUpdate, onDelete, onStartFixture, onExportOne, onPrint }: {
  tournaments: Tournament[];
  archive: SavedMatch[];
  onCreate: () => void;
  onUpdate: (id: string, patch: Partial<Tournament>) => void;
  onDelete: (id: string) => void;
  onStartFixture: (tournament: Tournament, fixture: Fixture) => void;
  onExportOne: (tournament: Tournament) => void;
  onPrint: (tournament: Tournament) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const expanded = tournaments.find((tournament) => tournament.id === expandedId) ?? null;
  const activeTournaments = tournaments.filter((tournament) => !tournament.archived);
  const archivedTournaments = tournaments.filter((tournament) => tournament.archived);

  const renderCard = (tournament: Tournament) => (
        <div key={tournament.id} className={`tournament-card ${expanded?.id === tournament.id ? "is-open" : ""}`}>
          <button className="tournament-head" onClick={() => setExpandedId((current) => (current === tournament.id ? null : tournament.id))}>
            <strong>{tournament.name || "Unbenanntes Turnier"}</strong>
            <span>{formatDate(`${tournament.date}T00:00:00`)} · {tournament.fixtures.length} Spiele</span>
          </button>

          {expanded?.id === tournament.id && (
            <div className="tournament-body">
              <div className="meta-grid">
                <label><span>Name</span><input value={tournament.name} onChange={(event) => onUpdate(tournament.id, { name: event.target.value })} /></label>
                <label><span>Datum</span><input type="date" value={tournament.date} onChange={(event) => onUpdate(tournament.id, { date: event.target.value })} /></label>
                <label><span>Jugend</span><select value={tournament.ageGroup} onChange={(event) => {
                  const selected = ageGroups.find((group) => group.value === event.target.value)!;
                  onUpdate(tournament.id, { ageGroup: selected.value, halfDurationMinutes: selected.minutes });
                }}>{ageGroups.map((group) => <option key={group.value} value={group.value}>{group.label}</option>)}</select></label>
                <label><span>Minuten je Halbzeit</span><input type="number" min={1} max={60} value={tournament.halfDurationMinutes} onChange={(event) => onUpdate(tournament.id, { halfDurationMinutes: Number(event.target.value) || 1 })} /></label>
                <label className="wide"><span>Gruppen (mit Komma trennen)</span><input value={tournament.groups.join(", ")} onChange={(event) => {
                  const groups = event.target.value.split(",").map((group) => group.trim()).filter(Boolean);
                  onUpdate(tournament.id, { groups: groups.length ? [...new Set(groups)] : ["A"] });
                }} /></label>
              </div>

              {tournament.groups.map((group) => {
                const fixtures = tournament.fixtures.filter((fixture) => fixture.group === group);
                const table = standings(tournament, archive, group);
                return (
                  <div key={group} className="tournament-group">
                    <h4>Gruppe {group}</h4>
                    <div className="table-scroll">
                      <table className="fixture-table">
                        <thead><tr><th>Heim</th><th>Gast</th><th>Anstoß</th><th>Ergebnis</th><th aria-label="Aktionen" /></tr></thead>
                        <tbody>
                          {fixtures.length === 0 && <tr><td colSpan={5}>Noch keine Ansetzung.</td></tr>}
                          {fixtures.map((fixture) => {
                            const linked = fixture.matchId ? archive.find((entry) => entry.state.id === fixture.matchId)?.state ?? null : null;
                            const result = linked && linked.phase === "finished" ? `${score(linked.events, "home")} : ${score(linked.events, "away")}` : linked ? "läuft" : "–";
                            const setFixture = (patch: Partial<Fixture>) => onUpdate(tournament.id, {
                              fixtures: tournament.fixtures.map((entry) => (entry.id === fixture.id ? { ...entry, ...patch } : entry)),
                            });
                            return (
                              <tr key={fixture.id}>
                                <td><input value={fixture.home} placeholder="Heim" onChange={(event) => setFixture({ home: event.target.value })} /></td>
                                <td><input value={fixture.away} placeholder="Gast" onChange={(event) => setFixture({ away: event.target.value })} /></td>
                                <td><input className="kickoff" value={fixture.kickoff} placeholder="10:00" onChange={(event) => setFixture({ kickoff: event.target.value })} /></td>
                                <td className="num">{result}</td>
                                <td className="fixture-actions">
                                  <button className="text-button" onClick={() => onStartFixture(tournament, fixture)}>{linked ? "Neu anpfeifen" : "Anpfiff"}</button>
                                  <button className="text-button danger-text" aria-label="Ansetzung entfernen" onClick={() => onUpdate(tournament.id, { fixtures: tournament.fixtures.filter((entry) => entry.id !== fixture.id) })}><Icon name="trash" /></button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <button className="text-button" onClick={() => onUpdate(tournament.id, { fixtures: [...tournament.fixtures, createFixture(group)] })}><Icon name="plus" /> Spiel hinzufügen</button>

                    {table.length > 0 && (
                      <div className="table-scroll">
                        <table className="standings-table">
                          <thead><tr><th>#</th><th>Mannschaft</th><th>Sp</th><th>S</th><th>U</th><th>N</th><th>Tore</th><th>Diff</th><th>Pkt</th></tr></thead>
                          <tbody>
                            {table.map((row, index) => (
                              <tr key={row.team}>
                                <td className="num">{index + 1}</td>
                                <td>{row.team}</td>
                                <td className="num">{row.played}</td>
                                <td className="num">{row.won}</td>
                                <td className="num">{row.drawn}</td>
                                <td className="num">{row.lost}</td>
                                <td className="num">{row.goalsFor}:{row.goalsAgainst}</td>
                                <td className="num">{row.goalDiff > 0 ? `+${row.goalDiff}` : row.goalDiff}</td>
                                <td className="num"><strong>{row.points}</strong></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}

              <div className="tournament-tools">
                <button className="icon-button" onClick={() => onPrint(tournament)}><Icon name="print" /> Turnier als PDF</button>
                <button className="icon-button" onClick={() => onExportOne(tournament)}><Icon name="download" /> Turnier exportieren</button>
                <button className="icon-button" onClick={() => onUpdate(tournament.id, { archived: !tournament.archived })}><Icon name={tournament.archived ? "refresh" : "check"} /> {tournament.archived ? "Wiederherstellen" : "Archivieren"}</button>
                <button className="icon-button danger" onClick={() => onDelete(tournament.id)}><Icon name="trash" /> Turnier löschen</button>
              </div>
            </div>
          )}
        </div>
  );

  return (
    <div className="tournament-panel">
      <button className="icon-button" onClick={onCreate}><Icon name="plus" /> Neues Turnier</button>
      {activeTournaments.length === 0 && archivedTournaments.length === 0 && <p className="collapsible-hint">Noch kein Turnier angelegt.</p>}

      {activeTournaments.map(renderCard)}

      {archivedTournaments.length > 0 && (
        <div className="archived-tournaments">
          <button className="text-button" onClick={() => setShowArchived((value) => !value)}>
            <Icon name="list" /> Archivierte Turniere ({archivedTournaments.length}) · {showArchived ? "ausblenden" : "anzeigen"}
          </button>
          {showArchived && archivedTournaments.map(renderCard)}
        </div>
      )}
    </div>
  );
}

export function TournamentReport({ tournament, archive }: { tournament: Tournament; archive: SavedMatch[] }) {
  return (
    <div className="match-report tournament-report">
      <div className="report-brand">SQUORA · Schiedsrichter Note</div>
      <h3>Turnierbericht – {tournament.name || "Unbenanntes Turnier"}</h3>
      <div className="report-meta">
        <span><b>Datum:</b> {formatDate(`${tournament.date}T00:00:00`)}</span>
        <span><b>Altersklasse:</b> {ageGroups.find((group) => group.value === tournament.ageGroup)?.label ?? tournament.ageGroup} · 2 × {tournament.halfDurationMinutes} Min.</span>
      </div>
      {tournament.groups.map((group) => {
        const fixtures = tournament.fixtures.filter((fixture) => fixture.group === group);
        const table = standings(tournament, archive, group);
        return (
          <div key={group} className="report-group">
            <h4>Gruppe {group}</h4>
            <table className="report-table">
              <thead><tr><th>#</th><th>Mannschaft</th><th>Sp</th><th>S</th><th>U</th><th>N</th><th>Tore</th><th>Diff</th><th>Pkt</th></tr></thead>
              <tbody>
                {table.map((row, index) => (
                  <tr key={row.team}>
                    <td className="num">{index + 1}</td><td>{row.team}</td><td className="num">{row.played}</td>
                    <td className="num">{row.won}</td><td className="num">{row.drawn}</td><td className="num">{row.lost}</td>
                    <td className="num">{row.goalsFor}:{row.goalsAgainst}</td>
                    <td className="num">{row.goalDiff > 0 ? `+${row.goalDiff}` : row.goalDiff}</td>
                    <td className="num">{row.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="report-table">
              <thead><tr><th>Anstoß</th><th>Begegnung</th><th>Ergebnis</th></tr></thead>
              <tbody>
                {fixtures.map((fixture) => {
                  const linked = fixture.matchId ? archive.find((entry) => entry.state.id === fixture.matchId)?.state ?? null : null;
                  const result = linked && linked.phase === "finished" ? `${score(linked.events, "home")} : ${score(linked.events, "away")}` : "–";
                  return <tr key={fixture.id}><td className="num">{fixture.kickoff || "–"}</td><td>{fixture.home || "?"} – {fixture.away || "?"}</td><td className="num">{result}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

export function TeamLibraryPanel({ teams, onUpdate, onDelete, onClear, onApply, onAdd, onImportNewTeam, onImportRoster }: {
  teams: SavedTeam[];
  onUpdate: (id: string, patch: Partial<SavedTeam>) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  onApply: (side: TeamSide, id: string) => void;
  onAdd: () => void;
  onImportNewTeam: (file: File) => void;
  onImportRoster: (teamId: string, file: File) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const csvInput = useRef<HTMLInputElement>(null);
  return (
    <div className="tournament-panel">
      <div className="tournament-tools">
        <button className="icon-button" onClick={onAdd}><Icon name="plus" /> Team anlegen</button>
        <button className="icon-button" onClick={() => csvInput.current?.click()}><Icon name="upload" /> Team aus DFBnet-CSV</button>
        <input ref={csvInput} type="file" accept=".csv,text/csv" hidden onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onImportNewTeam(file);
          event.target.value = "";
        }} />
        {teams.length > 0 && <button className="icon-button danger" onClick={onClear}><Icon name="trash" /> Bibliothek leeren</button>}
      </div>
      <p className="collapsible-hint">DFBnet: „Mannschaften → Spieler → Export" (CSV). Die Liste enthält Namen, aber keine Rückennummern – diese im Kader ergänzen.</p>
      {teams.length === 0 && <p className="collapsible-hint">Noch keine Teams gespeichert. Lege hier eins an oder speichere ein Team aus „Mannschaftsaufstellungen".</p>}
      {teams.map((team) => (
        <div key={team.id} className={`tournament-card ${expandedId === team.id ? "is-open" : ""}`}>
          <div className="tournament-head-row">
            <button className="tournament-head" onClick={() => setExpandedId((current) => (current === team.id ? null : team.id))}>
              <strong>{team.name || "Unbenanntes Team"}</strong>
              <span>{team.club ? `${team.club} · ` : ""}{team.roster.length} Spieler</span>
            </button>
            <button className="mini-icon danger" aria-label={`${team.name || "Team"} löschen`} onClick={() => onDelete(team.id)}><Icon name="trash" /></button>
          </div>
          {expandedId === team.id && (
            <div className="tournament-body">
              <div className="meta-grid">
                <label><span>Name</span><input value={team.name} onChange={(event) => onUpdate(team.id, { name: event.target.value })} /></label>
                <label><span>Verein / Zusatz</span><input value={team.club} onChange={(event) => onUpdate(team.id, { club: event.target.value })} /></label>
              </div>
              <RosterEditor teamLabel="Kader" roster={team.roster} onChange={(next) => onUpdate(team.id, { roster: next })} onImportCsv={(file) => onImportRoster(team.id, file)} />
              <div className="tournament-tools">
                <button className="icon-button" onClick={() => onApply("home", team.id)}><Icon name="check" /> Als Heim übernehmen</button>
                <button className="icon-button" onClick={() => onApply("away", team.id)}><Icon name="check" /> Als Gast übernehmen</button>
                <button className="icon-button danger" onClick={() => onDelete(team.id)}><Icon name="trash" /> Löschen</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function StatsPanel({ archive, range, onRange, onExport }: {
  archive: SavedMatch[];
  range: { from: string; to: string };
  onRange: (patch: Partial<{ from: string; to: string }>) => void;
  onExport: () => void;
}) {
  const stats = useMemo(() => seasonStats(archive, range.from, range.to), [archive, range.from, range.to]);
  const tiles: { label: string; value: number }[] = [
    { label: "Spiele", value: stats.matches },
    { label: "Tore", value: stats.goals },
    { label: "Gelb", value: stats.yellow },
    { label: "Gelb-Rot", value: stats.yellowRed },
    { label: "Rot", value: stats.red },
    { label: "Zeitstrafen", value: stats.timePenalties },
    { label: "Wechsel", value: stats.substitutions },
    { label: "Abbrüche", value: stats.abandoned },
  ];
  return (
    <div className="stats-panel">
      <div className="meta-grid">
        <label><span>Von</span><input type="date" value={range.from} onChange={(event) => onRange({ from: event.target.value })} /></label>
        <label><span>Bis</span><input type="date" value={range.to} onChange={(event) => onRange({ to: event.target.value })} /></label>
      </div>
      <div className="stats-tiles">
        {tiles.map((tile) => (
          <div key={tile.label} className="stat-tile"><strong>{tile.value}</strong><span>{tile.label}</span></div>
        ))}
      </div>
      {stats.byAge.length > 0 && (
        <ul className="stats-byage">
          {stats.byAge.map((row) => <li key={row.label}><span>{row.label}</span><strong>{row.matches}</strong></li>)}
        </ul>
      )}
      <button className="icon-button" onClick={onExport} disabled={stats.matches === 0}><Icon name="download" /> Statistik als CSV</button>
    </div>
  );
}
