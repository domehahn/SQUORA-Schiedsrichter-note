import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { parseDfbnetExternal, type ExternalRosterEntry } from "./dfbnet";
import { readCsvFile } from "./integrations/dfbnet/decode";
import {
  clearPlayers, createPlayer, deletePlayer, fetchDfbnetImports, fetchPlayers, pushDfbnetRoster, updatePlayer,
  type DfbnetImportRow, type PlayerInput, type RosterPlayer,
} from "./sync";

/** Name + shirt number + pass number handed to the library / match lineup. Never the birthdate. */
export interface RosterExportEntry { name: string; number: string; pass: string }

interface Props {
  clubId: string;
  teamId: string;
  teamName: string;
  onCopyToLibrary: (entries: RosterExportEntry[]) => void;
  onCopyToLineup: (side: "home" | "away", entries: RosterExportEntry[]) => void;
}

interface Preview { filename: string; players: ExternalRosterEntry[]; mode: "merge" | "replace" }

/**
 * The referee's own team roster, stored server-side in the `players` table with
 * pass number and birthdate for the passport / eligibility check. DFBnet CSVs go
 * through the staged /dfbnet/imports endpoint (fingerprint, audit, minimization).
 * Copying into the team library or a match lineup carries name + shirt number +
 * pass number only — the birthdate never leaves this panel.
 */
export function TeamRosterPanel({ clubId, teamId, teamName, onCopyToLibrary, onCopyToLineup }: Props) {
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

  /** Split view of a player's name: prefer the stored parts, else derive from the legacy combined `name`. */
  const nameParts = (player: RosterPlayer): { firstName: string; lastName: string } => {
    if (player.firstName !== null || player.lastName !== null) return { firstName: player.firstName ?? "", lastName: player.lastName ?? "" };
    const full = (player.name ?? "").trim();
    const cut = full.lastIndexOf(" ");
    return cut > 0 ? { firstName: full.slice(0, cut), lastName: full.slice(cut + 1) } : { firstName: "", lastName: full };
  };

  const saveField = async (player: RosterPlayer, patch: Partial<Pick<PlayerInput, "firstName" | "lastName" | "shirtNumber" | "passNumber" | "birthdate">>) => {
    const base = nameParts(player);
    const next = {
      firstName: (patch.firstName ?? base.firstName).trim(),
      lastName: (patch.lastName ?? base.lastName).trim(),
      shirtNumber: (patch.shirtNumber ?? player.shirtNumber ?? "").trim(),
      passNumber: (patch.passNumber ?? player.passNumber ?? "").trim(),
      birthdate: (patch.birthdate ?? player.birthdate ?? "").trim(),
    };
    if (!next.firstName && !next.lastName) { setError("Vor- oder Nachname ist erforderlich."); return; }
    const unchanged = next.firstName === base.firstName && next.lastName === base.lastName
      && next.shirtNumber === (player.shirtNumber ?? "")
      && next.passNumber === (player.passNumber ?? "")
      && next.birthdate === (player.birthdate ?? "");
    if (unchanged) return;
    setError(null);
    const result = await updatePlayer(clubId, teamId, player.id, { version: player.version, ...next });
    if (result === "conflict") { flash("Von einem anderen Gerät geändert – neu geladen."); await reload(); return; }
    if (!result) { setError("Änderung konnte nicht gespeichert werden (Format von Geburtsdatum prüfen: TT.MM.JJJJ)."); return; }
    setPlayers((list) => list.map((entry) => (entry.id === player.id ? result : entry)));
  };

  const addPlayer = async () => {
    setBusy(true);
    setError(null);
    const created = await createPlayer(clubId, teamId, { lastName: "Neuer Spieler" });
    setBusy(false);
    if (!created) { setError("Spieler konnte nicht angelegt werden."); return; }
    setPlayers((list) => [...list, created].sort((a, b) => (a.lastName ?? a.name).localeCompare(b.lastName ?? b.name)));
  };

  const removePlayer = async (player: RosterPlayer) => {
    if (!window.confirm(`${player.name} aus dem Kader entfernen?`)) return;
    const ok = await deletePlayer(clubId, teamId, player.id, player.version);
    if (!ok) { await reload(); return; }
    setPlayers((list) => list.filter((entry) => entry.id !== player.id));
  };

  const clearRoster = async () => {
    if (!window.confirm(`Wirklich alle ${players.length} Spieler aus „${teamName}" löschen? Das lässt sich nicht rückgängig machen.`)) return;
    setBusy(true);
    setError(null);
    const ok = await clearPlayers(clubId, teamId);
    setBusy(false);
    if (!ok) { setError("Der Kader konnte nicht geleert werden."); await reload(); return; }
    setPlayers([]);
    flash("Kader geleert.");
  };

  const onCsv = async (file: File) => {
    setError(null);
    try {
      const parsed = parseDfbnetExternal(await readCsvFile(file), file.name);
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

  const exportEntries = (): RosterExportEntry[] => players.map((p) => ({ name: p.name, number: p.shirtNumber ?? "", pass: p.passNumber ?? "" }));
  const withPass = preview?.players.filter((p) => p.passNumber).length ?? 0;
  const withBirthdate = preview?.players.filter((p) => p.birthdate).length ?? 0;

  return (
    <div className="tournament-panel">
      <p className="collapsible-hint">
        Kader von <strong>{teamName}</strong>, serverseitig gespeichert. DFBnet-Importe laufen über den geprüften Import-Workflow
        (Fingerprint, Protokoll, Datenminimierung). <strong>Passnummer und Geburtsdatum</strong> werden hier für die Passkontrolle
        gespeichert; das Geburtsdatum verlässt diesen Kader nicht – bei „In Bibliothek/Aufstellung übernehmen" wandern nur Name,
        Rückennummer und Passnummer mit.
      </p>

      {notice && <div className="dialog-warning" role="status">{notice}</div>}
      {error && <div className="tenant-error" role="alert">{error}</div>}

      {loading ? <p className="collapsible-hint">Lade Kader …</p> : <>
        <div className="table-scroll">
          <table className="roster-table">
            <thead><tr><th>Nr.</th><th>Vorname</th><th>Nachname</th><th>Passnr.</th><th>Geb. (TT.MM.JJJJ)</th><th aria-label="Entfernen" /></tr></thead>
            <tbody>
              {players.length === 0 && <tr><td colSpan={6}>Noch keine Spieler. Lege welche an oder importiere eine DFBnet-CSV.</td></tr>}
              {players.map((player) => {
                const parts = nameParts(player);
                return (
                <tr key={player.id}>
                  <td><input className="roster-num" inputMode="numeric" maxLength={8} defaultValue={player.shirtNumber ?? ""} onBlur={(event) => void saveField(player, { shirtNumber: event.target.value })} /></td>
                  <td><input className="roster-name" maxLength={80} defaultValue={parts.firstName} onBlur={(event) => void saveField(player, { firstName: event.target.value })} /></td>
                  <td><input className="roster-name" maxLength={80} defaultValue={parts.lastName} onBlur={(event) => void saveField(player, { lastName: event.target.value })} /></td>
                  <td><input className="roster-pass" maxLength={40} defaultValue={player.passNumber ?? ""} onBlur={(event) => void saveField(player, { passNumber: event.target.value })} /></td>
                  <td><input className="roster-birth" inputMode="numeric" maxLength={12} placeholder="TT.MM.JJJJ" defaultValue={player.birthdate ?? ""} onBlur={(event) => void saveField(player, { birthdate: event.target.value })} /></td>
                  <td><button className="mini-icon danger" aria-label={`${player.name} entfernen`} onClick={() => void removePlayer(player)}><Icon name="trash" /></button></td>
                </tr>
                );
              })}
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
          {players.length > 0 && <button className="text-button danger" disabled={busy} onClick={() => void clearRoster()}><Icon name="trash" /> Kader leeren</button>}
        </div>

        {players.length > 0 && (
          <div className="roster-actions">
            <button className="text-button" onClick={() => { onCopyToLibrary(exportEntries()); flash("In die Team-Bibliothek übernommen."); }}><Icon name="check" /> In Team-Bibliothek</button>
            <button className="text-button" onClick={() => { onCopyToLineup("home", exportEntries()); flash("Als Heim-Aufstellung übernommen."); }}><Icon name="check" /> → Heim-Aufstellung</button>
            <button className="text-button" onClick={() => { onCopyToLineup("away", exportEntries()); flash("Als Gast-Aufstellung übernommen."); }}><Icon name="check" /> → Gast-Aufstellung</button>
          </div>
        )}
      </>}

      {preview && (
        <div className="tournament-body">
          <h4>{preview.players.length} Spieler aus „{preview.filename}"</h4>
          <p className="collapsible-hint">{withPass} mit Passnummer · {withBirthdate} mit Geburtsdatum – beides wird im Kader gespeichert.</p>
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
