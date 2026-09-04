import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { parseDfbnetExternal, type ExternalRosterEntry } from "./dfbnet";
import {
  createPlayer, deletePlayer, fetchDfbnetImports, fetchPlayers, pushDfbnetRoster, updatePlayer,
  type DfbnetImportRow, type RosterPlayer,
} from "./sync";

interface Props {
  clubId: string;
  teamId: string;
  teamName: string;
}

interface Preview { filename: string; players: ExternalRosterEntry[]; mode: "merge" | "replace" }

/**
 * The referee's own team roster, stored server-side in the `players` table.
 * DFBnet CSVs go through the staged /dfbnet/imports endpoint (fingerprint,
 * audit, minimization) rather than the client sync blob.
 */
export function TeamRosterPanel({ clubId, teamId, teamName }: Props) {
  const [players, setPlayers] = useState<RosterPlayer[]>([]);
  const [imports, setImports] = useState<DfbnetImportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const csvInput = useRef<HTMLInputElement>(null);

  const reload = async () => {
    const [p, i] = await Promise.all([fetchPlayers(clubId, teamId), fetchDfbnetImports(clubId, teamId)]);
    if (p) setPlayers(p);
    if (i) setImports(i);
    if (!p) setError("Kader konnte nicht geladen werden.");
    setLoading(false);
  };

  useEffect(() => { setLoading(true); void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [clubId, teamId]);

  const flash = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(null), 3000); };

  const saveField = async (player: RosterPlayer, patch: { name?: string; shirtNumber?: string }) => {
    const name = (patch.name ?? player.name).trim();
    const shirtNumber = patch.shirtNumber ?? player.shirtNumber ?? "";
    if (!name || (name === player.name && shirtNumber === (player.shirtNumber ?? ""))) return;
    setError(null);
    const result = await updatePlayer(clubId, teamId, player.id, { version: player.version, name, shirtNumber });
    if (result === "conflict") { flash("Von einem anderen Gerät geändert – neu geladen."); await reload(); return; }
    if (!result) { setError("Änderung konnte nicht gespeichert werden."); return; }
    setPlayers((list) => list.map((entry) => (entry.id === player.id ? result : entry)));
  };

  const addPlayer = async () => {
    setBusy(true);
    setError(null);
    const created = await createPlayer(clubId, teamId, { name: "Neuer Spieler" });
    setBusy(false);
    if (!created) { setError("Spieler konnte nicht angelegt werden."); return; }
    setPlayers((list) => [...list, created].sort((a, b) => a.name.localeCompare(b.name)));
  };

  const removePlayer = async (player: RosterPlayer) => {
    if (!window.confirm(`${player.name} aus dem Kader entfernen?`)) return;
    const ok = await deletePlayer(clubId, teamId, player.id, player.version);
    if (!ok) { await reload(); return; }
    setPlayers((list) => list.filter((entry) => entry.id !== player.id));
  };

  const onCsv = async (file: File) => {
    setError(null);
    try {
      const parsed = parseDfbnetExternal(await file.text(), file.name);
      if (parsed.players.length === 0) { setError("Keine Spieler in der Datei erkannt."); return; }
      setPreview({ filename: file.name, players: parsed.players, mode: players.length > 0 ? "merge" : "replace" });
    } catch {
      setError("Die CSV-Datei konnte nicht gelesen werden.");
    }
  };

  const runImport = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    const result = await pushDfbnetRoster(clubId, teamId, { filename: preview.filename, players: preview.players, mode: preview.mode });
    setBusy(false);
    if (!result.ok) { setError("Import fehlgeschlagen."); return; }
    setPreview(null);
    flash(`${result.recordCount} Spieler importiert (${preview.mode === "replace" ? "ersetzt" : "zusammengeführt"}).`);
    await reload();
  };

  return (
    <div className="tournament-panel">
      <p className="collapsible-hint">
        Kader von <strong>{teamName}</strong>, serverseitig gespeichert. DFBnet-Importe laufen über den geprüften Import-Workflow
        (Fingerprint, Protokoll, Datenminimierung) – Geburtsdatum und Passnummer werden dabei nicht auf den Server übernommen.
      </p>

      {notice && <div className="dialog-warning" role="status">{notice}</div>}
      {error && <div className="tenant-error" role="alert">{error}</div>}

      {loading ? <p className="collapsible-hint">Lade Kader …</p> : <>
        <div className="table-scroll">
          <table className="roster-table">
            <thead><tr><th>Nr.</th><th>Name</th><th aria-label="Entfernen" /></tr></thead>
            <tbody>
              {players.length === 0 && <tr><td colSpan={3}>Noch keine Spieler. Lege welche an oder importiere eine DFBnet-CSV.</td></tr>}
              {players.map((player) => (
                <tr key={player.id}>
                  <td><input className="roster-num" inputMode="numeric" maxLength={8} defaultValue={player.shirtNumber ?? ""} onBlur={(event) => void saveField(player, { shirtNumber: event.target.value })} /></td>
                  <td><input className="roster-name" maxLength={120} defaultValue={player.name} onBlur={(event) => void saveField(player, { name: event.target.value })} /></td>
                  <td><button className="mini-icon danger" aria-label={`${player.name} entfernen`} onClick={() => void removePlayer(player)}><Icon name="trash" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="roster-actions">
          <button className="text-button" disabled={busy} onClick={() => void addPlayer()}><Icon name="plus" /> Spieler hinzufügen</button>
          <button className="text-button" disabled={busy} onClick={() => csvInput.current?.click()}><Icon name="upload" /> DFBnet-CSV</button>
          <input ref={csvInput} type="file" accept=".csv,text/csv" hidden onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void onCsv(file);
            event.target.value = "";
          }} />
        </div>
      </>}

      {preview && (
        <div className="tournament-body">
          <h4>{preview.players.length} Spieler aus „{preview.filename}"</h4>
          <label className="tenant-check"><input type="radio" name="import-mode" checked={preview.mode === "merge"} onChange={() => setPreview({ ...preview, mode: "merge" })} /><span>Zusammenführen – vorhandene Spieler aktualisieren, neue ergänzen</span></label>
          <label className="tenant-check"><input type="radio" name="import-mode" checked={preview.mode === "replace"} onChange={() => setPreview({ ...preview, mode: "replace" })} /><span>Ersetzen – Kader exakt auf diese Liste bringen (nicht enthaltene Spieler werden entfernt)</span></label>
          <div className="modal-actions">
            <button className="save-button" disabled={busy} onClick={() => void runImport()}><Icon name="check" /> Importieren</button>
            <button className="text-button" onClick={() => setPreview(null)}>Abbrechen</button>
          </div>
        </div>
      )}

      {imports.length > 0 && (
        <div className="archived-tournaments">
          <h4>Import-Protokoll</h4>
          <ul className="stats-byage">
            {imports.map((entry) => (
              <li key={entry.id}>
                <span>{entry.filename} · {entry.createdAt.slice(0, 10)}</span>
                <strong>{entry.recordCount} · {entry.status}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
