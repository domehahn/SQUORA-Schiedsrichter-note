import { useEffect, useMemo, useState } from "react";
import { Icon } from "./icons";
import { LEGACY_MIGRATED_KEY, TENANT_INDEX_CACHE_KEY, seedLocal } from "./localData";
import {
  createTenant,
  mergeTenantIndex,
  sanitizeTenantIndex,
  unlockTenant,
  type TenantIndex,
  type TenantMeta,
} from "./tenant";
import {
  emptyCloudData,
  fetchLegacy,
  fetchTenantIndex,
  pushTenantData,
  pushTenantIndex,
  type CloudData,
} from "./sync";

function loadCachedIndex(): TenantIndex {
  try {
    return sanitizeTenantIndex(JSON.parse(localStorage.getItem(TENANT_INDEX_CACHE_KEY) ?? "{}"));
  } catch {
    return { updatedAt: null, tenants: [] };
  }
}

function cacheIndex(index: TenantIndex): void {
  try {
    localStorage.setItem(TENANT_INDEX_CACHE_KEY, JSON.stringify(index));
  } catch {
    /* ignore */
  }
}

interface Props {
  rememberedId: string | null;
  onUnlock: (tenant: TenantMeta, key: CryptoKey) => void;
}

export function TenantGate({ rememberedId, onUnlock }: Props) {
  const [index, setIndex] = useState<TenantIndex>(loadCachedIndex);
  const [legacy, setLegacy] = useState<CloudData | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(rememberedId);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [takeLegacy, setTakeLegacy] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchTenantIndex().then((remote) => {
      if (cancelled || !remote) return;
      setIndex((local) => {
        const merged = mergeTenantIndex(local, remote);
        cacheIndex(merged);
        return merged;
      });
    });
    if (localStorage.getItem(LEGACY_MIGRATED_KEY) !== "1") {
      fetchLegacy().then((data) => {
        if (!cancelled) setLegacy(data);
      });
    }
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (index.tenants.length === 0) setCreating(true);
  }, [index.tenants.length]);

  const selected = useMemo(
    () => index.tenants.find((tenant) => tenant.id === selectedId) ?? null,
    [index.tenants, selectedId],
  );

  const unlock = async (meta: TenantMeta) => {
    setBusy(true);
    setError(null);
    const key = await unlockTenant(meta, pass);
    setBusy(false);
    if (!key) {
      setError("Passphrase falsch.");
      return;
    }
    onUnlock(meta, key);
  };

  const create = async () => {
    if (pass.length < 6) {
      setError("Passphrase mindestens 6 Zeichen.");
      return;
    }
    if (pass !== pass2) {
      setError("Passphrasen stimmen nicht überein.");
      return;
    }
    setBusy(true);
    setError(null);
    const { meta, key } = await createTenant(name || "Mein Verein", pass);
    const nextIndex: TenantIndex = { updatedAt: new Date().toISOString(), tenants: [...index.tenants, meta] };
    setIndex(nextIndex);
    cacheIndex(nextIndex);
    void pushTenantIndex(nextIndex);

    const seed = takeLegacy && legacy ? legacy : emptyCloudData();
    seedLocal(meta.id, seed);
    if (takeLegacy && legacy) {
      void pushTenantData(meta.id, key, legacy);
      try {
        localStorage.setItem(LEGACY_MIGRATED_KEY, "1");
      } catch {
        /* ignore */
      }
    }
    setBusy(false);
    onUnlock(meta, key);
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
        <div className="tenant-brand">
          <img src={`${import.meta.env.BASE_URL}squora-logo.png`} alt="" />
          <span><strong>SQUORA</strong><small>Schiedsrichter Note</small></span>
        </div>

        {creating ? (
          <>
            <h1>{index.tenants.length === 0 ? "Ersten Verein anlegen" : "Neuen Verein anlegen"}</h1>
            <p className="tenant-hint">
              Die Daten dieses Vereins werden mit deiner Passphrase verschlüsselt. Ohne die Passphrase sind sie
              nicht wiederherstellbar – notiere sie sicher.
            </p>
            <label><span>Vereinsname</span>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="z. B. SV Blau" autoFocus />
            </label>
            <label><span>Passphrase</span>
              <input type="password" autoComplete="new-password" value={pass} onChange={(event) => setPass(event.target.value)} />
            </label>
            <label><span>Passphrase wiederholen</span>
              <input type="password" autoComplete="new-password" value={pass2} onChange={(event) => setPass2(event.target.value)} />
            </label>
            {legacy && (
              <label className="tenant-check">
                <input type="checkbox" checked={takeLegacy} onChange={(event) => setTakeLegacy(event.target.checked)} />
                <span>Bestehende, noch nicht zugeordnete Daten ({legacy.archive.length} Spiel(e), {legacy.tournaments.length} Turnier(e)) in diesen Verein übernehmen</span>
              </label>
            )}
            {error && <div className="tenant-error" role="alert">{error}</div>}
            <button className="tenant-primary" disabled={busy}><Icon name="check" /> Verein anlegen &amp; öffnen</button>
            {index.tenants.length > 0 && (
              <button type="button" className="tenant-link" onClick={() => { setCreating(false); setError(null); }}>Zurück zur Auswahl</button>
            )}
          </>
        ) : (
          <>
            <h1>Verein wählen</h1>
            <p className="tenant-hint">Ereignisse werden pro Verein getrennt und verschlüsselt gespeichert.</p>
            <label><span>Verein</span>
              <select value={selectedId ?? ""} onChange={(event) => { setSelectedId(event.target.value || null); setError(null); }}>
                <option value="">– bitte wählen –</option>
                {index.tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
              </select>
            </label>
            <label><span>Passphrase</span>
              <input type="password" autoComplete="current-password" value={pass} onChange={(event) => setPass(event.target.value)} disabled={!selected} autoFocus />
            </label>
            {error && <div className="tenant-error" role="alert">{error}</div>}
            <button className="tenant-primary" disabled={busy || !selected}><Icon name="check" /> Öffnen</button>
            <button type="button" className="tenant-link" onClick={() => { setCreating(true); setError(null); setPass(""); setPass2(""); }}>
              <Icon name="plus" /> Weiteren Verein anlegen
            </button>
          </>
        )}
      </form>
      <form method="post" action={`${import.meta.env.BASE_URL}auth/logout`} className="tenant-logout">
        <button><Icon name="logout" /> Abmelden</button>
      </form>
    </div>
  );
}
