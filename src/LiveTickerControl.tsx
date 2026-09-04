import { useState } from "react";
import qrcode from "qrcode-generator";
import { Icon } from "./icons";
import { disableLiveShare, enableLiveShare } from "./sync";

const BASE = import.meta.env.BASE_URL ?? "/";

interface Props {
  clubId: string;
  teamId: string;
}

/**
 * Public, read-only live-ticker link for the currently running match (score +
 * generic event log, no player names) with a QR code to hand to spectators.
 * The QR is rendered client-side (bundled qrcode-generator, no third-party
 * network call) as a data: URI.
 */
export function LiveTickerControl({ clubId, teamId }: Props) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const enable = async () => {
    setBusy(true);
    setError(null);
    const result = await enableLiveShare(clubId, teamId);
    setBusy(false);
    if (!result) { setError("Erst nach Anpfiff verfügbar."); return; }
    setToken(result.token);
  };

  const disable = async () => {
    setBusy(true);
    await disableLiveShare(clubId, teamId);
    setBusy(false);
    setToken(null);
  };

  const toggle = () => {
    setOpen((value) => !value);
    setError(null);
  };

  if (!open) {
    return <button className="icon-button" onClick={toggle}><Icon name="share" /> Liveticker</button>;
  }

  if (!token) {
    return (
      <div className="live-share">
        <p className="collapsible-hint">Öffentliche Ergebnis-Seite (Spielstand + Ereignisse, keine Namen) für Zuschauer – z. B. per QR-Code.</p>
        {error && <div className="tenant-error" role="alert">{error}</div>}
        <div className="roster-actions">
          <button className="text-button" disabled={busy} onClick={() => void enable()}><Icon name="check" /> Liveticker freigeben</button>
          <button className="text-button" onClick={toggle}>Schließen</button>
        </div>
      </div>
    );
  }

  const url = `${window.location.origin}${BASE}live/${token}`;
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();

  return (
    <div className="live-share">
      <img className="live-share-qr" src={qr.createDataURL(6, 4)} width={148} height={148} alt="QR-Code zum Liveticker" />
      <label><span>Link</span><input readOnly value={url} onFocus={(event) => event.target.select()} /></label>
      <div className="roster-actions">
        <button
          className="text-button"
          onClick={() => { void navigator.clipboard?.writeText(url).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 2000); }); }}
        >
          <Icon name="check" /> {copied ? "Kopiert" : "Link kopieren"}
        </button>
        <button className="text-button danger" disabled={busy} onClick={() => void disable()}><Icon name="trash" /> Deaktivieren</button>
        <button className="text-button" onClick={toggle}>Schließen</button>
      </div>
    </div>
  );
}
