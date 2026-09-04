export const ACTIVE_TENANT_KEY = "squora-referee-note-active-tenant-v1";
export const TENANT_INDEX_CACHE_KEY = "squora-referee-note-tenant-index-v1";
export const LEGACY_MIGRATED_KEY = "squora-referee-note-legacy-migrated-v1";
export const SOUND_KEY = "squora-referee-note-sound-v1";
export const THEME_KEY = "squora-referee-note-theme-v1";

/** Legacy plaintext key. Read only by the explicit migration flow; never write new data here. */
export function lsKey(name: string, tenantId: string): string {
  return `squora-referee-note-${name}-v1:${tenantId}`;
}
