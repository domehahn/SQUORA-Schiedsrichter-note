import type { CloudData } from "./sync";

export const ACTIVE_TENANT_KEY = "squora-referee-note-active-tenant-v1";
export const TENANT_INDEX_CACHE_KEY = "squora-referee-note-tenant-index-v1";
export const LEGACY_MIGRATED_KEY = "squora-referee-note-legacy-migrated-v1";
export const SOUND_KEY = "squora-referee-note-sound-v1";

/** Per-Verein localStorage key. Data of other Vereine is never written to this device. */
export function lsKey(name: string, tenantId: string): string {
  return `squora-referee-note-${name}-v1:${tenantId}`;
}

/** Writes a Verein's decrypted cloud data into the per-Verein local cache (used after unlock / migration). */
export function seedLocal(tenantId: string, data: CloudData): void {
  try {
    localStorage.setItem(lsKey("archive", tenantId), JSON.stringify(data.archive));
    localStorage.setItem(lsKey("deleted", tenantId), JSON.stringify(data.deletedIds));
    localStorage.setItem(lsKey("tournaments", tenantId), JSON.stringify(data.tournaments));
    localStorage.setItem(lsKey("teams", tenantId), JSON.stringify(data.teams));
    if (data.current) localStorage.setItem(lsKey("match", tenantId), JSON.stringify(data.current));
  } catch {
    /* storage unavailable – the app will still sync from the server */
  }
}
