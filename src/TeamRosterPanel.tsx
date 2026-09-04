import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { parseDfbnetExternal, type ExternalRosterEntry } from "./dfbnet";
import { readCsvFile } from "./integrations/dfbnet/decode";
import {
  clearPlayers, createPlayer, deletePlayer, fetchDfbnetImports, fetchPlayers, pushDfbnetRoster, updatePlayer,
  type DfbnetImportRow, type RosterPlayer,
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

/** One editable row: `base` is the loaded server row, or null for a row added in this edit session. */
interface DraftRow {
  key: string;
  base: RosterPlayer | null;
  firstName: string;
  lastName: string;
  shirtNumber: string;
  passNumber: string;
  birthdate: string;
  removed: boolean;
}

/** Split a player's name: prefer the stored parts, else derive from the legacy combined `name`. */
function nameParts(player: RosterPlayer): { firstName: string; lastName: string } {
  if (player.firstName !== null || player.lastName !== null) return { firstName: player.firstName ?? "", lastName: player.lastName ?? "" };
  const full = (player.name ?? "").trim();
  const cut = full.lastIndexOf(" ");
  return cut > 0 ? { firstName: full.slice(0, cut), lastName: full.slice(cut + 1) } : { firstName: "", lastName: full };
}

function toDraft(player: RosterPlayer): DraftRow {
  const { firstName, lastName } = nameParts(player);
  return { key: player.id, base: player, firstName, lastName, shirtNumber: player.shirtNumber ?? "", passNumber: player.passNumber ?? "", birthdate: player.birthdate ?? "", removed: false };
}

const emptyRow = (): DraftRow => ({ key: crypto.randomUUID(), base: null, firstName: "", lastName: "", shirtNumber: "", passNumber: "", birthdate: "", removed: false });
const rowFilled = (row: DraftRow) => Boolean(row.firstName.trim() || row.lastName.trim());
const rowChanged = (row: DraftRow) => {
  if (!row.base) return rowFilled(row);
  const b = toDraft(row.base);
  return row.firstName.trim() !== b.firstName || row.lastName.trim() !== b.lastName
    || row.shirtNumber.trim() !== b.shirtNumber || row.passNumber.trim() !== b.passNumber || row.birthdate.trim() !== b.birthdate;
};

/**
 * The referee's own team roster, stored server-side in the `players` table with
 * pass number and birthdate for the passport / eligibility check. This is the
 * only place the roster is imported or edited: the table is read-only until
 * "Bearbeiten", changes are gathered and written on "Speichern". DFBnet CSVs go
 * through the staged /dfbnet/imports endpoint (fingerprint, audit, minimization).
 */
export function TeamRosterPanel({ clubId, teamId, teamName, onCopyToLibrary, onCopyToLineup }: Props) {
  const [players, setPlayers] = useState<RosterPlayer[]>([]);
  const [imports, setImports] = useState<DfbnetImportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DraftRow[]>([]);
  const csvInput = useRef<HTMLInputElement>(null);

  const reload = async (): Promise<RosterPlayer[] | null> => {
    const [p, i] = await Promise.all([fetchPlayers(clubId, teamId), fetchDfbnetImports(clubId, teamId)]);
    if (p) setPlayers(p);
    if (i) setImports(i);
    if (!p) setError("Kader konnte nicht geladen werden.");
    setLoading(false);
    return p;
  };

  useEffect(() => { setLoading(true); setEditing(false); void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [clubId, teamId]);

  const flash = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(null), 3000); };

  const startEdit = (from: RosterPlayer[] = players) => { setDraft(from.map(toDraft)); setEditing(true); setError(null); };
  const cancelEdit = () => { setDraft([]); setEditing(false); setError(null); };
  const patchRow = (key: string, patch: Partial<DraftRow>) => setDraft((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const dropRow = (key: string) => setDraft((rows) => rows.flatMap((row) => (row.key !== key ? [row] : row.base ? [{ ...row, removed: true }] : [])));

  const saveEdit = async () => {
    setBusy(true);
    setError(null);
    let conflict = false;
    let failed = false;
    for (const row of draft) {
      if (row.removed && row.base) {
        if (!(await deletePlayer(clubId, teamId, row.base.id, row.base.version))) failed = true;
        continue;
      }
      if (row.removed) continue;
      if (!row.base) {
        if (!rowFilled(row)) continue;
        const created = await createPlayer(clubId, teamId, { firstName: row.firstName.trim(), lastName: row.lastName.trim(), shirtNumber: row.shirtNumber.trim(), passNumber: row.passNumber.trim(), birthdate: row.birthdate.trim() });
        if (!created) failed = true;
        continue;
      }
      if (!rowChanged(row)) continue;
      if (!row.firstName.trim() && !row.lastName.trim()) { failed = true; continue; }
      const result = await updatePlayer(clubId, teamId, row.base.id, { version: row.base.version, firstName: row.firstName.trim(), lastName: row.lastName.trim(), shirtNumber: row.shirtNumber.trim(), passNumber: row.passNumber.trim(), birthdate: row.birthdate.trim() });
      if (result === "conflict") conflict = true;
      else if (!result) failed = true;
    }
    const fresh = await reload();
    setBusy(false);
    if (conflict) { setError("Teile des Kaders wurden auf einem anderen Gerät geändert – neu geladen. Bitte Änderungen erneut prüfen."); startEdit(fresh ?? players); return; }
    if (failed) { setError("Nicht alle Änderungen konnten gespeichert werden (Geburtsdatum als TT.MM.JJJJ, Name erforderlich)."); startEdit(fresh ?? players); return; }
    setEditing(false);
    setDraft([]);
    flash("Kader gespeichert.");
  };

  const clearRoster = async () => {
    if (!window.confirm(`Wirklich alle ${players.length} Spieler aus „${teamName}" löschen? Das lässt sich nicht rückgängig machen.`)) return;
    setBusy(true);
    setError(null);
    const ok = await clearPlayers(clubId, teamId);
    const fresh = await reload();
    setBusy(false);
    if (!ok) { setError("Der Kader konnte nicht geleert werden."); return; }
    startEdit(fresh ?? []);
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
    const fresh = await reload();
    setBusy(false);
    if (!result.ok) { setError("Import fehlgeschlagen."); return; }
    setPreview(null);
    flash(`${result.recordCount} Spieler importiert (${preview.mode === "replace" ? "ersetzt" : "zusammengeführt"}).`);
    if (editing) startEdit(fresh ?? players);
  };

  const exportEntries = (): RosterExportEntry[] => players.map((p) => ({ name: p.name, number: p.shirtNumber ?? "", pass: p.passNumber ?? "" }));
  const withPass = preview?.players.filter((p) => p.passNumber).length ?? 0;
  const withBirthdate = preview?.players.filter((p) => p.birthdate).length ?? 0;
  const visibleDraft = draft.filter((row) => !row.removed);

  return (
    <div className="tournament-panel">
      <p className="collapsible-hint">
        Kader von <strong>{teamName}</strong>, serverseitig gespeichert – die einzige Stelle, an der importiert und bearbeitet wird.
        <strong> Passnummer und Geburtsdatum</strong> dienen der Passkontrolle; das Geburtsdatum verlässt diesen Kader nicht.
      </p>

      {notice && <div className="dialog-warning" role="status">{notice}</div>}
      {error && <div className="tenant-error" role="alert">{error}</div>}

      {loading ? <p className="collapsible-hint">Lade Kader …</p> : <>
        <div className="table-scroll">
          <table className="roster-table">
            <thead><tr><th>Nr.</th><th>Vorname</th><th>Nachname</th><th>Passnr.</th><th>Geb. (TT.MM.JJJJ)</th>{editing && <th aria-label="Entfernen" />}</tr></thead>
            <tbody>
              {!editing && players.length === 0 && <tr><td colSpan={5}>Noch keine Spieler. „Bearbeiten" → Spieler anlegen oder DFBnet-CSV importieren.</td></tr>}
              {!editing && players.map((player) => {
                const parts = nameParts(player);
                return (
                  <tr key={player.id}>
                    <td className="roster-num">{player.shirtNumber ?? ""}</td>
                    <td>{parts.firstName}</td>
                    <td>{parts.lastName}</td>
                    <td className="roster-pass">{player.passNumber ?? ""}</td>
                    <td className="roster-birth">{player.birthdate ?? ""}</td>
                  </tr>
                );
              })}
              {editing && visibleDraft.length === 0 && <tr><td colSpan={6}>Noch keine Spieler. „Spieler hinzufügen" oder DFBnet-CSV importieren.</td></tr>}
              {editing && visibleDraft.map((row) => (
                <tr key={row.key}>
                  <td><input className="roster-num" inputMode="numeric" maxLength={8} value={row.shirtNumber} onChange={(event) => patchRow(row.key, { shirtNumber: event.target.value })} /></td>
                  <td><input className="roster-name" maxLength={80} value={row.firstName} onChange={(event) => patchRow(row.key, { firstName: event.target.value })} /></td>
                  <td><input className="roster-name" maxLength={80} value={row.lastName} onChange={(event) => patchRow(row.key, { lastName: event.target.value })} /></td>
                  <td><input className="roster-pass" maxLength={40} value={row.passNumber} onChange={(event) => patchRow(row.key, { passNumber: event.target.value })} /></td>
                  <td><input className="roster-birth" inputMode="numeric" maxLength={12} placeholder="TT.MM.JJJJ" value={row.birthdate} onChange={(event) => patchRow(row.key, { birthdate: event.target.value })} /></td>
                  <td><button className="mini-icon danger" aria-label="Zeile entfernen" onClick={() => dropRow(row.key)}><Icon name="trash" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {editing ? <>
          <div className="roster-actions">
            <button className="text-button" disabled={busy} onClick={() => setDraft((rows) => [...rows, emptyRow()])}><Icon name="plus" /> Spieler hinzufügen</button>
            <button className="text-button" disabled={busy} onClick={() => csvInput.current?.click()}><Icon name="upload" /> DFBnet-CSV</button>
            <input ref={csvInput} type="file" accept=".csv,text/csv" hidden onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onCsv(file);
              event.target.value = "";
            }} />
            {players.length > 0 && <button className="text-button danger" disabled={busy} onClick={() => void clearRoster()}><Icon name="trash" /> Kader leeren</button>}
          </div>
          <div className="modal-actions">
            <button className="save-button" disabled={busy} onClick={() => void saveEdit()}><Icon name="check" /> Speichern</button>
            <button className="text-button" disabled={busy} onClick={cancelEdit}>Abbrechen</button>
          </div>
        </> : <>
          <div className="roster-actions">
            <button className="text-button" onClick={() => startEdit()}><Icon name="edit" /> Bearbeiten</button>
          </div>
          {players.length > 0 && (
            <div className="roster-actions">
              <button className="text-button" onClick={() => { onCopyToLibrary(exportEntries()); flash("In die Team-Bibliothek übernommen."); }}><Icon name="check" /> In Team-Bibliothek</button>
              <button className="text-button" onClick={() => { onCopyToLineup("home", exportEntries()); flash("Als Heim-Aufstellung übernommen."); }}><Icon name="check" /> → Heim-Aufstellung</button>
              <button className="text-button" onClick={() => { onCopyToLineup("away", exportEntries()); flash("Als Gast-Aufstellung übernommen."); }}><Icon name="check" /> → Gast-Aufstellung</button>
            </div>
          )}
        </>}
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
