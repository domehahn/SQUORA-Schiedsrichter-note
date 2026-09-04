import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { applyTheme, loadTheme, nextTheme, saveTheme, THEME_LABEL } from "./theme";

/** Self-contained light/dark/system toggle — mounted both in the tenant gate
 * (before a team is unlocked) and the main app's topbar, so the setting is
 * reachable everywhere, not just once inside a match. */
export function ThemeToggle({ className = "sound-toggle" }: { className?: string }) {
  const [theme, setTheme] = useState(loadTheme);
  useEffect(() => { applyTheme(theme); saveTheme(theme); }, [theme]);
  return (
    <button type="button" className={className} title={`Anzeige: ${THEME_LABEL[theme]} · tippen zum Wechseln`} onClick={() => setTheme((value) => nextTheme(value))}>
      <Icon name={theme === "light" ? "sun" : theme === "dark" ? "moon" : "monitor"} />
    </button>
  );
}
