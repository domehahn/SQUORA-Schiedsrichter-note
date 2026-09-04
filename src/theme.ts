import { THEME_KEY } from "./localData";

export type ThemeMode = "system" | "light" | "dark";

const MODES: readonly ThemeMode[] = ["system", "light", "dark"];

export function loadTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

export function saveTheme(mode: ThemeMode): void {
  try {
    if (mode === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, mode);
  } catch {
    /* ignore */
  }
}

/** Stamps (or clears) data-theme on the root element so styles.css's light/dark
 * token blocks pick the right palette, overriding the system preference when
 * the user has explicitly chosen light or dark. */
export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", mode);
}

export function nextTheme(mode: ThemeMode): ThemeMode {
  return MODES[(MODES.indexOf(mode) + 1) % MODES.length];
}

export const THEME_LABEL: Record<ThemeMode, string> = {
  system: "Systemeinstellung",
  light: "Hell",
  dark: "Dunkel",
};
