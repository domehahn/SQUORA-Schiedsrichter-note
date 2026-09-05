/**
 * Bridges the service worker's background update check (registerSW in
 * main.tsx) to a visible in-app banner (UpdateBanner.tsx), instead of the
 * previous silent-background-update behaviour. That silence directly caused
 * confusion this session: a new deploy would sit installed-but-inactive
 * until a full close/reopen, and users (and this agent, twice) mistook a
 * stale cached build for a broken app.
 */
export const SW_UPDATE_EVENT = "squora:sw-update-available";

let apply: (() => void) | null = null;

export function setApplyUpdate(fn: () => void): void {
  apply = fn;
}

export function applyUpdate(): void {
  apply?.();
}
