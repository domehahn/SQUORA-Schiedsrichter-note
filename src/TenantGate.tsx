import { useEffect, useMemo, useState } from "react";
import { deriveKey, fromBase64 } from "./crypto";
import { hasEncryptedCache, readEncryptedCache, writeEncryptedCache } from "./encryptedCache";
import { Icon } from "./icons";
import { ageGroups } from "./match";
import {
  createTeamUnit,
  createTenant,
  fetchLegacy,
  fetchMe,
  fetchTeams,
  fetchTenantIndex,
  pushTenantData,
  type CloudData,
} from "./sync";
import { scopeKey, type TeamUnit, type TenantMeta } from "./tenant";

interface Props {
  rememberedId: string | null;
  onUnlock: (userId: string, club: TenantMeta, team: TeamUnit, key: CryptoKey | null) => void;
}

type Step = "loading" | "onboarding" | "club" | "team" | "unlock" | "error";

const MIN_PASSPHRASE = 12;

export function TenantGate({ rememberedId, onUnlock }: Props) {
  const [, rememberClub, rememberTeam] = (rememberedId ?? "").split(":");
  const [step, setStep] = useState<Step>("loading");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [userId, setUserId] = useState<string>("");
  const [clubs, setClubs] = useState<TenantMeta[]>([]);
  const [legacy, setLegacy] = useState<CloudData | null>(null);

  const [club, setClub] = useState<TenantMeta | null>(null);
  const [teams, setTeams] = useState<TeamUnit[]>([]);
  const [team, setTeam] = useState<TeamUnit | null>(null);

  // onboarding / create-team form
  const [newClubName, setNewClubName] = useState("");
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamAge, setNewTeamAge] = useState("D");
  const [takeLegacy, setTakeLegacy] = useState(false);

  // unlock step
  const [cacheExists, setCacheExists] = useState(false);
  const [wantOffline, setWantOffline] = useState(false);
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [pendingLegacy, setPendingLegacy] = useState<CloudData | null>(null);

  // ---- bootstrap ---------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [me, list, legacyData] = await Promise.all([fetchMe(), fetchTenantIndex(), fetchLegacy()]);
      if (cancelled) return;
      if (!me || !list) { setError("Sitzung abgelaufen. Bitte melde dich erneut an."); setStep("error"); return; }
      setUserId(me.userId);
      setClubs(list);
      setLegacy(legacyData);
      if (list.length === 0) { setStep("onboarding"); return; }
      const remembered = list.find((entry) => entry.id === rememberClub);
      if (list.length === 1) { void chooseClub(list[0], legacyData); return; }
      if (remembered) { void chooseClub(remembered, legacyData); return; }
      setStep("club");
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- club -> team ----------------------------------------------------------

  const chooseClub = async (picked: TenantMeta, legacyData: CloudData | null = legacy): Promise<void> => {
    setBusy(true);
    setError(null);
    const list = await fetchTeams(picked.id);
    setBusy(false);
    if (!list) { setError("Mannschaften konnten nicht geladen werden."); return; }
    setClub(picked);
    setTeams(list);
    if (list.length === 0) { setStep("team"); return; } // create-team form
    const remembered = list.find((entry) => entry.id === rememberTeam);
    if (list.length === 1) { void chooseTeam(picked, list[0], legacyData); return; }
    if (remembered) { void chooseTeam(picked, remembered, legacyData); return; }
    setStep("team");
  };

  const chooseTeam = async (forClub: TenantMeta, picked: TeamUnit, legacyData: CloudData | null = legacy): Promise<void> => {
    setBusy(true);
    const scope = scopeKey(userId, forClub.id, picked.id);
    const exists = await hasEncryptedCache(scope);
    setBusy(false);
    setClub(forClub);
    setTeam(picked);
    setCacheExists(exists);
    setWantOffline(false);
    setPass("");
    setPass2("");
    setPendingLegacy(legacyData ?? null);
    setError(null);
    setStep("unlock");
  };

  // ---- create flows --------------------------------------------------------

  const createClubFlow = async (): Promise<void> => {
    if (!newClubName.trim()) { setError("Bitte einen Vereinsnamen eingeben."); return; }
    setBusy(true);
    setError(null);
    const created = await createTenant(newClubName.trim());
    if (!created) { setBusy(false); setError("Der Verein konnte nicht angelegt werden."); return; }
    setClubs((list) => [...list, created]);
    setBusy(false);
    await chooseClub(created, takeLegacy && legacy ? legacy : null);
  };

  const createTeamFlow = async (): Promise<void> => {
    if (!club) return;
    if (!newTeamName.trim()) { setError("Bitte einen Mannschaftsnamen eingeben."); return; }
    setBusy(true);
    setError(null);
    const created = await createTeamUnit(club.id, newTeamName.trim(), newTeamAge || null);
    setBusy(false);
    if (!created) { setError("Die Mannschaft konnte nicht angelegt werden."); return; }
    setTeams((list) => [...list, created]);
    await chooseTeam(club, created);
  };

  // ---- unlock / open -----------------------------------------------------

  const finish = async (key: CryptoKey | null): Promise<void> => {
    if (!club || !team) return;
    if (pendingLegacy) {
      setBusy(true);
      const migrated = await pushTenantData(club.id, team.id, key, pendingLegacy);
      if (migrated && key) await writeEncryptedCache(scopeKey(userId, club.id, team.id), key, pendingLegacy);
      setBusy(false);
      if (!migrated) { setError("Die bestehenden Daten konnten nicht übernommen werden."); return; }
      setPendingLegacy(null);
    }
    onUnlock(userId, club, team, key);
  };

  const openOnline = () => void finish(null);

  const unlockOffline = async (): Promise<void> => {
    if (!club || !team) return;
    if (pass.length < MIN_PASSPHRASE) { setError(`Passphrase mindestens ${MIN_PASSPHRASE} Zeichen.`); return; }
    if (!cacheExists && pass !== pass2) { setError("Passphrasen stimmen nicht überein."); return; }
    setBusy(true);
    setError(null);
    try {
      const key = await deriveKey(pass, fromBase64(club.cacheSalt));
      if (cacheExists && !(await readEncryptedCache(scopeKey(userId, club.id, team.id), key))) {
        setBusy(false);
        setError("Passphrase falsch – die verschlüsselten Offline-Daten lassen sich damit nicht öffnen.");
        return;
      }
      setBusy(false);
      await finish(key);
    } catch {
      setBusy(false);
      setError("Der verschlüsselte Speicher konnte nicht geöffnet werden.");
    }
  };

  // ---- render ----------------------------------------------------------

  const clubName = club?.name ?? "";
  const ageOptions = useMemo(() => ageGroups.filter((group) => group.value !== "custom"), []);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (step === "onboarding") void createClubFlow();
    else if (step === "team" && teams.length === 0) void createTeamFlow();
    else if (step === "unlock") { if (cacheExists || wantOffline) void unlockOffline(); else openOnline(); }
  };

  return (
    <div className="tenant-gate">
      <form className="tenant-card" onSubmit={submit}>
        <div className="tenant-brand"><img src={`${import.meta.env.BASE_URL}squora-logo.png`} alt="" /><span><strong>SQUORA</strong><small>Schiedsrichter Note</small></span></div>

        {step === "loading" && <p className="tenant-hint">Lade deine Vereine …</p>}

        {step === "error" && <div className="tenant-error" role="alert">{error}</div>}

        {step === "onboarding" && <>
          <h1>Willkommen bei SQUORA</h1>
          <p className="tenant-hint">Du bist noch keinem Verein zugeordnet. Lege deinen Verein an – du wirst automatisch dessen Inhaber. Weitere Personen kommen später nur über einen Einladungslink hinzu.</p>
          <label><span>Vereinsname</span><input value={newClubName} maxLength={120} onChange={(event) => setNewClubName(event.target.value)} placeholder="z. B. FC Beispielstadt" autoFocus /></label>
          {legacy && <label className="tenant-check"><input type="checkbox" checked={takeLegacy} onChange={(event) => setTakeLegacy(event.target.checked)} /><span>Daten aus der alten Version in die erste Mannschaft übernehmen</span></label>}
          {error && <div className="tenant-error" role="alert">{error}</div>}
          <button className="tenant-primary" disabled={busy}><Icon name="check" /> Verein anlegen</button>
        </>}

        {step === "club" && <>
          <h1>Verein wählen</h1>
          <p className="tenant-hint">Angezeigt werden nur Vereine, für die du eine aktive Mitgliedschaft hast.</p>
          <div className="tenant-list">
            {clubs.map((entry) => (
              <button key={entry.id} type="button" className="tenant-list-item" disabled={busy} onClick={() => void chooseClub(entry)}>
                <Icon name="shield" /> <span>{entry.name}</span>
              </button>
            ))}
          </div>
          {error && <div className="tenant-error" role="alert">{error}</div>}
          <button type="button" className="tenant-link" onClick={() => { setError(null); setStep("onboarding"); }}><Icon name="plus" /> Weiteren Verein anlegen</button>
        </>}

        {step === "team" && <>
          <h1>{teams.length === 0 ? "Erste Mannschaft anlegen" : `${clubName} – Mannschaft wählen`}</h1>
          {teams.length === 0 ? <>
            <p className="tenant-hint">Jede Jugend/Mannschaft erfasst getrennt – eigenes Archiv, eigene Uhr, keine Vermischung.</p>
            <label><span>Mannschaft</span><input value={newTeamName} maxLength={120} onChange={(event) => setNewTeamName(event.target.value)} placeholder="z. B. D1" autoFocus /></label>
            <label><span>Altersklasse</span><select value={newTeamAge} onChange={(event) => setNewTeamAge(event.target.value)}>{ageOptions.map((group) => <option key={group.value} value={group.value}>{group.label}</option>)}</select></label>
            {error && <div className="tenant-error" role="alert">{error}</div>}
            <button className="tenant-primary" disabled={busy}><Icon name="check" /> Anlegen &amp; öffnen</button>
          </> : <>
            <p className="tenant-hint">Wähle die Mannschaft, für die du erfasst. Die Daten der anderen bleiben unberührt.</p>
            <div className="tenant-list">
              {teams.map((entry) => (
                <button key={entry.id} type="button" className="tenant-list-item" disabled={busy} onClick={() => club && void chooseTeam(club, entry)}>
                  <Icon name="whistle" /> <span>{entry.name}{entry.ageGroup ? ` · ${entry.ageGroup}` : ""}</span>
                </button>
              ))}
            </div>
            {error && <div className="tenant-error" role="alert">{error}</div>}
            <button type="button" className="tenant-link" onClick={() => { setTeams([]); setNewTeamName(""); setError(null); }}><Icon name="plus" /> Neue Mannschaft anlegen</button>
          </>}
          <button type="button" className="tenant-link" onClick={() => { setError(null); setStep("club"); }}>{clubs.length > 1 ? "Verein wechseln" : "Anderer Verein"}</button>
        </>}

        {step === "unlock" && <>
          <h1>{clubName} · {team?.name}</h1>
          {cacheExists ? <>
            <p className="tenant-hint">Auf diesem Gerät liegen verschlüsselte Offline-Daten. Gib die Geräte-Passphrase ein, um sie zu entsperren.</p>
            <label><span>Geräte-Passphrase</span><input type="password" autoComplete="current-password" value={pass} onChange={(event) => setPass(event.target.value)} autoFocus /></label>
            {error && <div className="tenant-error" role="alert">{error}</div>}
            <button className="tenant-primary" disabled={busy}><Icon name="check" /> Entsperren &amp; öffnen</button>
          </> : wantOffline ? <>
            <p className="tenant-hint">Lege eine Passphrase für diesen Browser fest. Sie verschlüsselt ausschließlich die lokal gespeicherten Spieldaten und wird nie übertragen.</p>
            <label><span>Passphrase (mind. {MIN_PASSPHRASE} Zeichen)</span><input type="password" autoComplete="new-password" value={pass} onChange={(event) => setPass(event.target.value)} autoFocus /></label>
            <label><span>Passphrase wiederholen</span><input type="password" autoComplete="new-password" value={pass2} onChange={(event) => setPass2(event.target.value)} /></label>
            {error && <div className="tenant-error" role="alert">{error}</div>}
            <button className="tenant-primary" disabled={busy}><Icon name="check" /> Offline-Schutz einrichten &amp; öffnen</button>
            <button type="button" className="tenant-link" onClick={() => { setWantOffline(false); setError(null); }}>Doch nur online arbeiten</button>
          </> : <>
            <p className="tenant-hint">Du arbeitest online – die Daten liegen auf dem Server. Optional kannst du diesen Browser für die Offline-Nutzung einrichten.</p>
            {error && <div className="tenant-error" role="alert">{error}</div>}
            <button className="tenant-primary" disabled={busy}><Icon name="check" /> Öffnen</button>
            <button type="button" className="tenant-link" onClick={() => { setWantOffline(true); setError(null); }}><Icon name="download" /> Offline-Nutzung einrichten</button>
          </>}
          <button type="button" className="tenant-link" onClick={() => { setError(null); setStep(teams.length > 1 ? "team" : "club"); }}>{teams.length > 1 ? "Mannschaft wechseln" : "Verein / Mannschaft wechseln"}</button>
        </>}
      </form>
      <form method="post" action={`${import.meta.env.BASE_URL}auth/logout`} className="tenant-logout"><button><Icon name="logout" /> Abmelden</button></form>
    </div>
  );
}
