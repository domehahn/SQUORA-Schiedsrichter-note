import { useEffect, useMemo, useState } from "react";
import { decryptString, deriveKey, fromBase64 } from "./crypto";
import { Icon } from "./icons";
import { mergeTeams } from "./teams";
import { mergeTournaments } from "./tournament";
import {
  applyDeletions,
  fetchLegacyTenantPayload,
  fetchLegacyTenantSources,
  fetchTenantData,
  mergeArchives,
  migrateLegacyTenant,
  parseCloudData,
  type LegacyTenantSource,
} from "./sync";
import type { TeamUnit, TenantMeta } from "./tenant";

const VERIFIER = "squora-verein-v1";

export function LegacyMigrationPanel({ club, team }: { club: TenantMeta; team: TeamUnit }) {
  const [sources, setSources] = useState<LegacyTenantSource[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchLegacyTenantSources().then((list) => {
      if (!cancelled) { setSources(list); setSelectedId(list[0]?.id ?? ""); }
    });
    return () => { cancelled = true; };
  }, []);

  const selected = useMemo(() => sources.find((entry) => entry.id === selectedId) ?? null, [sources, selectedId]);
  if (sources.length === 0 || !club.permissions.includes("matches.update")) return null;

  const migrate = async () => {
    if (!selected || !passphrase) return;
    setBusy(true);
    setMessage(null);
    try {
      const legacyKey = await deriveKey(passphrase, fromBase64(selected.salt));
      if (await decryptString(legacyKey, selected.verifierIv, selected.verifier) !== VERIFIER) {
        setMessage("Die alte Vereins-Passphrase ist falsch.");
        return;
      }
      const [source, target] = await Promise.all([
        fetchLegacyTenantPayload(selected.id),
        fetchTenantData(club.id, team.id),
      ]);
      if (!source || !target.ok) { setMessage("Quell- oder Zieldaten konnten nicht geladen werden."); return; }
      const plaintext = await decryptString(legacyKey, source.payload.iv, source.payload.ciphertext);
      if (!plaintext) { setMessage("Die alten Daten konnten nicht entschlüsselt werden."); return; }
      const legacy = parseCloudData(JSON.parse(plaintext));
      const deletedIds = [...new Set([...target.data.deletedIds, ...legacy.deletedIds])];
      const merged = {
        archive: applyDeletions(mergeArchives(target.data.archive, legacy.archive), deletedIds),
        deletedIds,
        tournaments: mergeTournaments(target.data.tournaments, legacy.tournaments),
        teams: mergeTeams(target.data.teams, legacy.teams),
        current: target.data.current ?? legacy.current,
      };
      if (!window.confirm(`${legacy.archive.length} Spiel(e), ${legacy.tournaments.length} Turnier(e) und ${legacy.teams.length} Team-Einträge aus „${selected.name}“ verbindlich dieser Mannschaft zuordnen? Die alte Quelle bleibt unverändert erhalten.`)) return;
      if (!await migrateLegacyTenant(club.id, team.id, selected.id, source.sourceFingerprint, merged)) {
        setMessage("Migration fehlgeschlagen oder Quelle bereits anders zugeordnet.");
        return;
      }
      setSources((list) => list.filter((entry) => entry.id !== selected.id));
      setSelectedId("");
      setPassphrase("");
      setMessage("Migration abgeschlossen. Die alte KV-Quelle wurde nicht gelöscht.");
    } catch {
      setMessage("Die Legacy-Daten sind ungültig oder konnten nicht migriert werden.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="legacy-migration" aria-label="Daten aus alter Version migrieren">
      <h2>Alte Vereinsdaten gefunden</h2>
      <p className="tenant-hint">Ordne eine alte, verschlüsselte Datenablage ausdrücklich dieser Mannschaft zu.</p>
      <label><span>Alter Verein</span><select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</select></label>
      <label><span>Alte Vereins-Passphrase</span><input type="password" autoComplete="off" value={passphrase} placeholder=" " onChange={(event) => setPassphrase(event.target.value)} /></label>
      {message && <div className="tenant-error" role="status">{message}</div>}
      <button type="button" className="tenant-link" disabled={busy || !selected || !passphrase} onClick={() => void migrate()}><Icon name="upload" /> Kontrolliert migrieren</button>
    </section>
  );
}

