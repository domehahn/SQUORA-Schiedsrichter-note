// build 2026-09-04.1 — bump this comment whenever this file's cache needs a
// forced refresh; the service worker only re-fetches a precached file when
// its content hash actually changes.
//
// Applies a previously chosen light/dark override before first paint, so the
// UI never flashes the system-preference theme first. Loaded as a plain,
// same-origin script (not inline) to satisfy the app's script-src 'self' CSP,
// which has no 'unsafe-inline' allowance. Keep this in sync with the
// THEME_KEY / ThemeMode contract in src/theme.ts.
// Public route: this file must stay in PUBLIC_ASSETS / never require auth —
// the service worker precaches it regardless of session state.
(function () {
  try {
    var value = localStorage.getItem("squora-referee-note-theme-v1");
    if (value === "light" || value === "dark") {
      document.documentElement.setAttribute("data-theme", value);
    }
  } catch (error) {
    /* ignore */
  }
})();
