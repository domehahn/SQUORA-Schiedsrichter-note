/**
 * A build-time stamp, logged once on startup. Its only purpose is to make it
 * possible to tell, from a browser's console, which build a client is
 * actually running — invaluable whenever a service-worker precache issue is
 * suspected, since the SW only ever re-fetches a precached file when its
 * content (and therefore its hash) actually changes.
 */
export const BUILD_ID = "2026-09-04.1";
