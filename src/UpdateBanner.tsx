import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { applyUpdate, SW_UPDATE_EVENT } from "./swUpdate";

/** Shown once the service worker has a new version installed and waiting —
 * makes deploys visible instead of silently sitting inactive until the next
 * full close/reopen (see swUpdate.ts). */
export function UpdateBanner() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const handler = () => setVisible(true);
    window.addEventListener(SW_UPDATE_EVENT, handler);
    return () => window.removeEventListener(SW_UPDATE_EVENT, handler);
  }, []);
  if (!visible) return null;
  return (
    <div className="update-banner no-print" role="status">
      <Icon name="refresh" />
      <span>Neue Version verfügbar</span>
      <button type="button" onClick={() => applyUpdate()}>Aktualisieren</button>
    </div>
  );
}
