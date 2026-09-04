import { useRef } from "react";
import { Icon } from "./icons";
import { uid, type LineupStatus, type Player } from "./match";

export const LINEUP_GROUPS: { key: LineupStatus; label: string; short: string }[] = [
  { key: "start", label: "Aufgestellt", short: "Start" },
  { key: "bench", label: "Bank", short: "Bank" },
  { key: "out", label: "Nicht nominiert", short: "Nicht" },
];

/** Editable team roster table, optionally grouped by lineup status (Aufgestellt / Bank / Nicht nominiert). */
export function RosterEditor({ teamLabel, roster, onChange, onImportCsv, grouped = false }: {
  teamLabel: string;
  roster: Player[];
  onChange: (next: Player[]) => void;
  onImportCsv?: (file: File) => void;
  grouped?: boolean;
}) {
  const update = (id: string, patch: Partial<Player>) => onChange(roster.map((player) => (player.id === id ? { ...player, ...patch } : player)));
  const csvInput = useRef<HTMLInputElement>(null);

  const row = (player: Player) => (
    <tr key={player.id}>
      {grouped && (
        <td>
          <div className="status-chip" role="group" aria-label="Aufstellungsstatus">
            {LINEUP_GROUPS.map((group) => {
              const active = (player.status ?? "out") === group.key;
              return (
                <button
                  key={group.key}
                  type="button"
                  className={`status-seg seg-${group.key} ${active ? "active" : ""}`}
                  aria-pressed={active}
                  title={group.label}
                  onClick={() => update(player.id, { status: group.key })}
                >
                  {group.short}
                </button>
              );
            })}
          </div>
        </td>
      )}
      <td><input className="roster-num" inputMode="numeric" maxLength={4} placeholder="–" value={player.number} onChange={(event) => update(player.id, { number: event.target.value })} /></td>
      <td><input className="roster-name" maxLength={60} placeholder="Name" value={player.name} onChange={(event) => update(player.id, { name: event.target.value })} /></td>
      <td><input className="roster-pass" maxLength={30} placeholder="–" value={player.pass ?? ""} onChange={(event) => update(player.id, { pass: event.target.value })} /></td>
      <td><input className="roster-birth" maxLength={12} placeholder="TT.MM.JJJJ" value={player.birthdate ?? ""} onChange={(event) => update(player.id, { birthdate: event.target.value })} /></td>
      <td><button className="mini-icon danger" aria-label="Spieler entfernen" onClick={() => onChange(roster.filter((entry) => entry.id !== player.id))}><Icon name="trash" /></button></td>
    </tr>
  );

  const head = (
    <tr>
      {grouped && <th>Status</th>}
      <th>Nr.</th><th>Name</th><th>Passnr.</th><th>Geb.</th><th aria-label="Entfernen" />
    </tr>
  );

  return (
    <div className="roster-col">
      <h4>{teamLabel} {roster.length > 0 && <span className="count">{roster.length}</span>}</h4>

      {roster.length === 0 ? null : grouped ? (
        LINEUP_GROUPS.map((group) => {
          const players = roster.filter((player) => (player.status ?? "out") === group.key);
          if (players.length === 0) return <p key={group.key} className="roster-group-empty">{group.label} <span className="count">0</span></p>;
          return (
            <div key={group.key} className={`roster-group group-${group.key}`}>
              <h5>{group.label} <span className="count">{players.length}</span></h5>
              <div className="table-scroll">
                <table className="roster-table"><thead>{head}</thead><tbody>{players.map(row)}</tbody></table>
              </div>
            </div>
          );
        })
      ) : (
        <div className="table-scroll">
          <table className="roster-table"><thead>{head}</thead><tbody>{roster.map(row)}</tbody></table>
        </div>
      )}

      <div className="roster-actions">
        <button className="text-button" onClick={() => onChange([...roster, { id: uid(), number: "", name: "", pass: "", birthdate: "", status: grouped ? "start" : undefined }])}><Icon name="plus" /> Spieler hinzufügen</button>
        {onImportCsv && (
          <>
            <button className="text-button" onClick={() => csvInput.current?.click()}><Icon name="upload" /> DFBnet-CSV</button>
            <input ref={csvInput} type="file" accept=".csv,text/csv" hidden onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onImportCsv(file);
              event.target.value = "";
            }} />
          </>
        )}
        {grouped && roster.some((player) => (player.status ?? "out") !== "start") && (
          <button className="text-button" onClick={() => onChange(roster.map((player) => ({ ...player, status: "start" as LineupStatus })))}>Alle aufstellen</button>
        )}
      </div>
    </div>
  );
}
