import { useEffect, useMemo, useState } from "react";
import { deriveKey, fromBase64 } from "./crypto";
import { hasEncryptedCache, readEncryptedCache, writeEncryptedCache } from "./encryptedCache";
import { Icon } from "./icons";
import { ageGroups } from "./match";
import {
  createTeamUnit,
  createTenant,
  fetchLegacy,
  fetchTeams,
  fetchTenantIndex,
  pushTenantData,
  type CloudData,
} from "./sync";
import { scopeKey, type TeamUnit, type TenantMeta } from "./tenant";

interface Props {
  rememberedId: string | null;
  onUnlock: (club: TenantMeta, team: TeamUnit, key: CryptoKey) => void;
}

export function TenantGate({ rememberedId, onUnlock }: Props) {
  const [rememberedClubId, rememberedTeamId] = (rememberedId ?? "").split(":");
  const [clubs, setClubs] = useState<TenantMeta[]>([]);
  const [legacy, setLegacy] = useState<CloudData | null>(null);
  const [selectedClubId, setSelectedClubId] = useState<string | null>(rememberedClubId || null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [takeLegacy, setTakeLegacy] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Second step: a club is unlocked, now pick the team (Jugend) — the real data-isolation unit.
  const [unlockedClub, setUnlockedClub] = useState<{ club: TenantMeta; key: CryptoKey } | null>(null);
  const [pendingLegacy, setPendingLegacy] = useState<CloudData | null>(null);
  const [teams, setTeams] = useState<TeamUnit[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(rememberedTeamId || null);
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [teamAge, setTeamAge] = useState("D");

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchTenantIndex(), fetchLegacy()]).then(([available, legacyData]) => {
      if (cancelled) return;
      if (!available) {
        setError("Vereine konnten nicht geladen werden. Bitte melde dich erneut an.");
      } else {
        setClubs(available);
        if (!available.some((club) => club.id === rememberedClubId)) setSelectedClubId(available[0]?.id ?? null);
        if (available.length === 0) setCreating(true);
      }
      setLegacy(legacyData);
      setBusy(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedClub = useMemo(() => clubs.find((club) => club.id === selectedClubId) ?? null, [clubs, selectedClubId]);
  const selectedTeam = useMemo(() => teams.find((team) => team.id === selectedTeamId) ?? null, [teams, selectedTeamId]);

  const enterClub = async (club: TenantMeta, key: CryptoKey, legacyToMigrate: CloudData | null) => {
    setBusy(true);
    setError(null);
    const list = await fetchTeams(club.id);
    setBusy(false);
    if (!list) { setError("Mannschaften konnten nicht geladen werden."); return; }
    setUnlockedClub({ club, key });
    setPendingLegacy(legacyToMigrate);
    setTeams(list);
    setCreatingTeam(list.length === 0);
    if (!list.some((team) => team.id === rememberedTeamId)) setSelectedTeamId(list[0]?.id ?? null);
  };

  const deriveClubKey = async (club: TenantMeta): Promise<CryptoKey | null> => {
    if (pass.length < 12) { setError("Cache-Passphrase mindestens 12 Zeichen."); return null; }
    try {
      const key = await deriveKey(pass, fromBase64(club.cacheSalt));
      if (await hasEncryptedCache(club.id) && !(await readEncryptedCache(club.id, key))) {
        setError("Cache-Passphrase falsch. Ohne sie kann der Offline-Cache nicht geöffnet werden.");
        return null;
      }
      return key;
    } catch {
      setError("Der verschlüsselte Cache konnte nicht geöffnet werden.");
      return null;
    }
  };

  const unlockClub = async (club: TenantMeta) => {
    setBusy(true);
    setError(null);
    const key = await deriveClubKey(club);
    setBusy(false);
    if (key) await enterClub(club, key, null);
  };

  const createClub = async () => {
    if (!name.trim()) { setError("Bitte einen Vereinsnamen eingeben."); return; }
    if (pass.length < 12) { setError("Cache-Passphrase mindestens 12 Zeichen."); return; }
    if (pass !== pass2) { setError("Passphrasen stimmen nicht überein."); return; }
    setBusy(true);
    setError(null);
    const club = await createTenant(name.trim());
    if (!club) { setBusy(false); setError("Der Verein konnte nicht angelegt werden."); return; }
    const key = await deriveKey(pass, fromBase64(club.cacheSalt));
    setClubs((list) => [...list, club]);
    setBusy(false);
    await enterClub(club, key, takeLegacy && legacy ? legacy : null);
  };

  const openTeam = async (team: TeamUnit) => {
    if (!unlockedClub) return;
    if (pendingLegacy) {
      setBusy(true);
      const migrated = await pushTenantData(unlockedClub.club.id, team.id, unlockedClub.key, pendingLegacy);
      if (migrated) await writeEncryptedCache(scopeKey(unlockedClub.club.id, team.id), unlockedClub.key, pendingLegacy);
      setBusy(false);
      if (!migrated) { setError("Die bestehenden Daten konnten nicht migriert werden."); return; }
      setPendingLegacy(null);
    }
    onUnlock(unlockedClub.club, team, unlockedClub.key);
  };

  const createTeam = async () => {
    if (!unlockedClub) return;
    if (!teamName.trim()) { setError("Bitte einen Mannschaftsnamen eingeben."); return; }
    setBusy(true);
    setError(null);
    const team = await createTeamUnit(unlockedClub.club.id, teamName.trim(), teamAge || null);
    setBusy(false);
    if (!team) { setError("Die Mannschaft konnte nicht angelegt werden."); return; }
    setTeams((list) => [...list, team]);
    await openTeam(team);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (unlockedClub) {
      if (creatingTeam) void createTeam();
      else if (selectedTeam) void openTeam(selectedTeam);
      return;
    }
    if (creating) void createClub();
    else if (selectedClub) void unlockClub(selectedClub);
  };

  return (
    <div className="tenant-gate">
      <form className="tenant-card" onSubmit={submit}>
        <div className="tenant-brand"><img src={`${import.meta.env.BASE_URL}squora-logo.png`} alt="" /><span><strong>SQUORA</strong><small>Schiedsrichter Note</small></span></div>

        {unlockedClub ? (creatingTeam ? <>
          <h1>Mannschaft anlegen</h1>
          <p className="tenant-hint">Jede Jugend/Mannschaft von {unlockedClub.club.name} erfasst getrennt – eigenes Archiv, eigene Uhr, keine Vermischung.</p>
          <label><span>Mannschaft</span><input value={teamName} maxLength={120} onChange={(event) => setTeamName(event.target.value)} placeholder="z. B. D1" autoFocus /></label>
          <label><span>Altersklasse</span><select value={teamAge} onChange={(event) => setTeamAge(event.target.value)}>{ageGroups.filter((group) => group.value !== "custom").map((group) => <option key={group.value} value={group.value}>{group.label}</option>)}</select></label>
          {error && <div className="tenant-error" role="alert">{error}</div>}
          <button className="tenant-primary" disabled={busy}><Icon name="check" /> Anlegen &amp; öffnen</button>
          {teams.length > 0 && <button type="button" className="tenant-link" onClick={() => { setCreatingTeam(false); setError(null); }}>Zurück zur Auswahl</button>}
        </> : <>
          <h1>{unlockedClub.club.name} – Mannschaft wählen</h1>
          <p className="tenant-hint">Wähle die Jugend, für die du erfasst. Ergebnisse und Zeit anderer Mannschaften bleiben unberührt.</p>
          <label><span>Mannschaft</span><select value={selectedTeamId ?? ""} onChange={(event) => { setSelectedTeamId(event.target.value || null); setError(null); }}><option value="">– bitte wählen –</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}{team.ageGroup ? ` · ${team.ageGroup}` : ""}</option>)}</select></label>
          {error && <div className="tenant-error" role="alert">{error}</div>}
          <button className="tenant-primary" disabled={busy || !selectedTeam}><Icon name="check" /> Öffnen</button>
          <button type="button" className="tenant-link" onClick={() => { setCreatingTeam(true); setError(null); setTeamName(""); }}><Icon name="plus" /> Neue Mannschaft anlegen</button>
          <button type="button" className="tenant-link" onClick={() => { setUnlockedClub(null); setPendingLegacy(null); setError(null); }}>Verein wechseln</button>
        </>) : creating ? <>
          <h1>{clubs.length === 0 ? "Ersten Verein anlegen" : "Neuen Verein anlegen"}</h1>
          <p className="tenant-hint">Die Vereinsberechtigung wird serverseitig geprüft. Die zusätzliche Passphrase verschlüsselt ausschließlich den Offline-Cache dieses Browsers und wird nie übertragen.</p>
          <label><span>Vereinsname</span><input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder="z. B. FC Beispielstadt" autoFocus /></label>
          <label><span>Cache-Passphrase</span><input type="password" autoComplete="new-password" value={pass} onChange={(event) => setPass(event.target.value)} /></label>
          <label><span>Passphrase wiederholen</span><input type="password" autoComplete="new-password" value={pass2} onChange={(event) => setPass2(event.target.value)} /></label>
          {legacy && <label className="tenant-check"><input type="checkbox" checked={takeLegacy} onChange={(event) => setTakeLegacy(event.target.checked)} /><span>Bestehende Daten nach ausdrücklicher Zuordnung in die erste Mannschaft migrieren</span></label>}
          {error && <div className="tenant-error" role="alert">{error}</div>}
          <button className="tenant-primary" disabled={busy}><Icon name="check" /> Verein anlegen &amp; weiter</button>
          {clubs.length > 0 && <button type="button" className="tenant-link" onClick={() => { setCreating(false); setError(null); }}>Zurück zur Auswahl</button>}
        </> : <>
          <h1>Verein wählen</h1>
          <p className="tenant-hint">Angezeigt werden ausschließlich aktive Mitgliedschaften aus der Serverdatenbank.</p>
          <label><span>Verein</span><select value={selectedClubId ?? ""} onChange={(event) => { setSelectedClubId(event.target.value || null); setError(null); }}><option value="">– bitte wählen –</option>{clubs.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}</select></label>
          <label><span>Cache-Passphrase</span><input type="password" autoComplete="current-password" minLength={12} value={pass} onChange={(event) => setPass(event.target.value)} disabled={!selectedClub} autoFocus /></label>
          {error && <div className="tenant-error" role="alert">{error}</div>}
          <button className="tenant-primary" disabled={busy || !selectedClub}><Icon name="check" /> Weiter</button>
          <button type="button" className="tenant-link" onClick={() => { setCreating(true); setError(null); setPass(""); setPass2(""); }}><Icon name="plus" /> Weiteren Verein anlegen</button>
        </>}
      </form>
      <form method="post" action={`${import.meta.env.BASE_URL}auth/logout`} className="tenant-logout"><button><Icon name="logout" /> Abmelden</button></form>
    </div>
  );
}
