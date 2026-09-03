import { useEffect, useMemo, useState } from "react";
import { deriveKey, fromBase64 } from "./crypto";
import { hasEncryptedCache, readEncryptedCache, writeEncryptedCache } from "./encryptedCache";
import { Icon } from "./icons";
import { createTenant, fetchLegacy, fetchTenantIndex, pushTenantData, type CloudData } from "./sync";
import type { TenantMeta } from "./tenant";

interface Props {
  rememberedId: string | null;
  onUnlock: (tenant: TenantMeta, key: CryptoKey) => void;
}

export function TenantGate({ rememberedId, onUnlock }: Props) {
  const [clubs, setClubs] = useState<TenantMeta[]>([]);
  const [legacy, setLegacy] = useState<CloudData | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(rememberedId);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [takeLegacy, setTakeLegacy] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchTenantIndex(), fetchLegacy()]).then(([available, legacyData]) => {
      if (cancelled) return;
      if (!available) {
        setError("Vereine konnten nicht geladen werden. Bitte melde dich erneut an.");
      } else {
        setClubs(available);
        if (!available.some((club) => club.id === rememberedId)) setSelectedId(available[0]?.id ?? null);
        if (available.length === 0) setCreating(true);
      }
      setLegacy(legacyData);
      setBusy(false);
    });
    return () => { cancelled = true; };
  }, [rememberedId]);

  const selected = useMemo(() => clubs.find((club) => club.id === selectedId) ?? null, [clubs, selectedId]);

  const derive = async (club: TenantMeta): Promise<CryptoKey | null> => {
    if (pass.length < 12) {
      setError("Cache-Passphrase mindestens 12 Zeichen.");
      return null;
    }
    try {
      const key = await deriveKey(pass, fromBase64(club.cacheSalt));
      if (await hasEncryptedCache(club.id)) {
        const cached = await readEncryptedCache(club.id, key);
        if (!cached) {
          setError("Cache-Passphrase falsch. Ohne sie kann der Offline-Cache nicht geöffnet werden.");
          return null;
        }
      }
      return key;
    } catch {
      setError("Der verschlüsselte Cache konnte nicht geöffnet werden.");
      return null;
    }
  };

  const unlock = async (club: TenantMeta) => {
    setBusy(true);
    setError(null);
    const key = await derive(club);
    setBusy(false);
    if (key) onUnlock(club, key);
  };

  const create = async () => {
    if (!name.trim()) { setError("Bitte einen Vereinsnamen eingeben."); return; }
    if (pass.length < 12) { setError("Cache-Passphrase mindestens 12 Zeichen."); return; }
    if (pass !== pass2) { setError("Passphrasen stimmen nicht überein."); return; }
    setBusy(true);
    setError(null);
    const club = await createTenant(name.trim());
    if (!club) { setBusy(false); setError("Der Verein konnte nicht angelegt werden."); return; }
    const key = await deriveKey(pass, fromBase64(club.cacheSalt));
    if (takeLegacy && legacy) {
      const migrated = await pushTenantData(club.id, key, legacy);
      if (!migrated) { setBusy(false); setError("Die bestehenden Daten konnten nicht migriert werden."); return; }
      await writeEncryptedCache(club.id, key, legacy);
    }
    setBusy(false);
    onUnlock(club, key);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (creating) void create();
    else if (selected) void unlock(selected);
  };

  return (
    <div className="tenant-gate">
      <form className="tenant-card" onSubmit={submit}>
        <div className="tenant-brand"><img src={`${import.meta.env.BASE_URL}squora-logo.png`} alt="" /><span><strong>SQUORA</strong><small>Schiedsrichter Note</small></span></div>
        {creating ? <>
          <h1>{clubs.length === 0 ? "Ersten Verein anlegen" : "Neuen Verein anlegen"}</h1>
          <p className="tenant-hint">Die Vereinsberechtigung wird serverseitig geprüft. Die zusätzliche Passphrase verschlüsselt ausschließlich den Offline-Cache dieses Browsers und wird nie übertragen.</p>
          <label><span>Vereinsname</span><input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder="z. B. FC Beispielstadt" autoFocus /></label>
          <label><span>Cache-Passphrase</span><input type="password" autoComplete="new-password" value={pass} onChange={(event) => setPass(event.target.value)} /></label>
          <label><span>Passphrase wiederholen</span><input type="password" autoComplete="new-password" value={pass2} onChange={(event) => setPass2(event.target.value)} /></label>
          {legacy && <label className="tenant-check"><input type="checkbox" checked={takeLegacy} onChange={(event) => setTakeLegacy(event.target.checked)} /><span>Bestehende Daten nach ausdrücklicher Zuordnung in diesen Verein migrieren</span></label>}
          {error && <div className="tenant-error" role="alert">{error}</div>}
          <button className="tenant-primary" disabled={busy}><Icon name="check" /> Verein anlegen &amp; öffnen</button>
          {clubs.length > 0 && <button type="button" className="tenant-link" onClick={() => { setCreating(false); setError(null); }}>Zurück zur Auswahl</button>}
        </> : <>
          <h1>Verein wählen</h1>
          <p className="tenant-hint">Angezeigt werden ausschließlich aktive Mitgliedschaften aus der Serverdatenbank.</p>
          <label><span>Verein</span><select value={selectedId ?? ""} onChange={(event) => { setSelectedId(event.target.value || null); setError(null); }}><option value="">– bitte wählen –</option>{clubs.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}</select></label>
          <label><span>Cache-Passphrase</span><input type="password" autoComplete="current-password" minLength={12} value={pass} onChange={(event) => setPass(event.target.value)} disabled={!selected} autoFocus /></label>
          {error && <div className="tenant-error" role="alert">{error}</div>}
          <button className="tenant-primary" disabled={busy || !selected}><Icon name="check" /> Öffnen</button>
          <button type="button" className="tenant-link" onClick={() => { setCreating(true); setError(null); setPass(""); setPass2(""); }}><Icon name="plus" /> Weiteren Verein anlegen</button>
        </>}
      </form>
      <form method="post" action={`${import.meta.env.BASE_URL}auth/logout`} className="tenant-logout"><button><Icon name="logout" /> Abmelden</button></form>
    </div>
  );
}
