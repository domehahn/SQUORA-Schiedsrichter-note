import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import {
  eventMeta,
  rosterName,
  type ActionKind,
  type EventInput,
  type MatchEvent,
  type Player,
  type TeamSide,
} from "./match";

export interface DialogRequest {
  mode: "create" | "edit";
  action: ActionKind;
  team?: TeamSide;
  event?: MatchEvent;
}

interface Props {
  request: DialogRequest;
  teamLabel: string;
  roster: Player[];
  defaultTimeText: string;
  hasPriorYellow?: (player: string) => boolean;
  onClose: () => void;
  onSave: (payload: { kind: ActionKind; data: EventInput; timeText: string }) => void;
}

const NUMBER_KINDS = new Set<ActionKind>([
  "goal", "ownGoal", "penaltyGoal", "penaltyMissed", "yellow", "yellowRed", "red", "timePenalty",
]);

const TIME_RE = /^(\d{1,3}):([0-5]?\d)$/;

export function EventDialog({ request, teamLabel, roster, defaultTimeText, hasPriorYellow, onClose, onSave }: Props) {
  const previous = request.event;
  const [player, setPlayer] = useState(previous?.player ?? "");
  const [playerOut, setPlayerOut] = useState(previous?.playerOut ?? "");
  const [playerIn, setPlayerIn] = useState(previous?.playerIn ?? "");
  const [duration, setDuration] = useState(previous?.durationMin ?? (request.action === "timePenalty" ? 5 : 0));
  const [converted, setConverted] = useState(request.action !== "penaltyMissed");
  const [asSecondYellow, setAsSecondYellow] = useState(false);
  const [text, setText] = useState(previous?.text ?? "");
  const [timeText, setTimeText] = useState(previous?.exactTime ?? defaultTimeText);
  const firstInput = useRef<HTMLInputElement>(null);

  useEffect(() => firstInput.current?.focus(), []);

  const isSub = request.action === "substitution";
  const isNote = request.action === "note";
  const isPenalty = request.action === "penaltyGoal" || request.action === "penaltyMissed";
  const needsNumber = NUMBER_KINDS.has(request.action);

  const timeValid = TIME_RE.test(timeText.trim());
  const valid = timeValid && (isSub
    ? Boolean(playerOut.trim() && playerIn.trim())
    : isNote
      ? Boolean(text.trim())
      : needsNumber
        ? Boolean(player.trim())
        : true);

  const title = request.mode === "edit" ? `${eventMeta[request.action].title} bearbeiten` : eventMeta[request.action].title;
  const suggestedName = needsNumber ? rosterName(roster, player) : "";
  const secondYellow = request.action === "yellow" && request.mode === "create" && Boolean(hasPriorYellow?.(player));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    const kind: ActionKind = isPenalty
      ? (converted ? "penaltyGoal" : "penaltyMissed")
      : secondYellow && asSecondYellow
        ? "yellowRed"
        : request.action;
    const data: EventInput = isSub
      ? {
          playerOut: playerOut.trim(),
          playerOutName: rosterName(roster, playerOut),
          playerIn: playerIn.trim(),
          playerInName: rosterName(roster, playerIn),
        }
      : isNote
        ? { text: text.trim() }
        : {
            player: player.trim(),
            playerName: rosterName(roster, player),
            ...(request.action === "timePenalty" ? { durationMin: Number(duration) || 0 } : {}),
          };
    onSave({ kind, data, timeText: timeText.trim() });
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <button className="modal-close" onClick={onClose} aria-label="Dialog schließen"><Icon name="close" /></button>
        <span className={`modal-symbol ${request.action}`}>
          {request.action === "goal" || isPenalty ? <Icon name="ball" />
            : request.action === "ownGoal" ? <Icon name="ball" />
            : isSub ? <Icon name="swap" />
            : request.action === "timePenalty" ? <Icon name="stopwatch" />
            : isNote ? <Icon name="alert" />
            : <span className={`large-card ${request.action}`} />}
        </span>
        <div className="dialog-kicker">{teamLabel} · Spielzeit {timeText}</div>
        <h2 id="dialog-title">{title}</h2>

        <form onSubmit={submit}>
          <datalist id="roster-numbers">
            {roster.map((entry) => <option key={entry.id} value={entry.number}>{entry.number} {entry.name}</option>)}
          </datalist>

          {isSub ? (
            <div className="sub-fields">
              <label>
                <span>Rückennummer raus</span>
                <input ref={firstInput} list="roster-numbers" inputMode="numeric" pattern="[A-Za-z0-9\-]+" maxLength={4} value={playerOut} onChange={(e) => setPlayerOut(e.target.value)} placeholder="z. B. 8" />
                <small>{rosterName(roster, playerOut) || <><i className="out-arrow">↓</i> verlässt das Feld</>}</small>
              </label>
              <label>
                <span>Rückennummer rein</span>
                <input list="roster-numbers" inputMode="numeric" pattern="[A-Za-z0-9\-]+" maxLength={4} value={playerIn} onChange={(e) => setPlayerIn(e.target.value)} placeholder="z. B. 14" />
                <small>{rosterName(roster, playerIn) || <><i className="in-arrow">↑</i> betritt das Feld</>}</small>
              </label>
            </div>
          ) : isNote ? (
            <label className="player-field">
              <span>Vorkommnis</span>
              <textarea ref={firstInput as unknown as React.RefObject<HTMLTextAreaElement>} rows={3} maxLength={400} value={text} onChange={(e) => setText(e.target.value)} placeholder="z. B. Trinkpause, Behandlung, Zuschauer-Vorfall …" />
              <small>Erscheint in der Tabelle und im Spielbericht.</small>
            </label>
          ) : (
            <label className="player-field">
              <span>Rückennummer</span>
              <input ref={firstInput} list="roster-numbers" inputMode="numeric" pattern="[A-Za-z0-9\-]+" maxLength={4} value={player} onChange={(e) => setPlayer(e.target.value)} placeholder="z. B. 10" />
              <small>{suggestedName ? `→ ${suggestedName}` : "Name wird aus der Aufstellung übernommen, falls hinterlegt."}</small>
            </label>
          )}

          {secondYellow && (
            <div className="dialog-warning" role="alert">
              <strong>Nr. {player.trim()} hat bereits Gelb.</strong>
              <label className="checkbox-field">
                <input type="checkbox" checked={asSecondYellow} onChange={(e) => setAsSecondYellow(e.target.checked)} />
                <span>Als Gelb-Rot (Feldverweis) erfassen</span>
              </label>
            </div>
          )}

          {request.action === "timePenalty" && (
            <label className="player-field">
              <span>Dauer</span>
              <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                {[1, 2, 3, 5, 8, 10, 15].map((minutes) => <option key={minutes} value={minutes}>{minutes} Minuten</option>)}
              </select>
            </label>
          )}

          {isPenalty && (
            <label className="checkbox-field">
              <input type="checkbox" checked={converted} onChange={(e) => setConverted(e.target.checked)} />
              <span>Elfmeter verwandelt</span>
            </label>
          )}

          <details className="time-override" open={request.mode === "edit"}>
            <summary>Zeitpunkt anpassen</summary>
            <label className="player-field">
              <span>Spielzeit (MM:SS)</span>
              <input inputMode="numeric" value={timeText} onChange={(e) => setTimeText(e.target.value)} placeholder="z. B. 42:15" aria-invalid={!timeValid} />
              <small>{timeValid ? "Fortlaufende Spielzeit inkl. 2. Halbzeit." : "Bitte im Format MM:SS eingeben."}</small>
            </label>
          </details>

          <div className="modal-actions">
            <button type="button" className="cancel-button" onClick={onClose}>Abbrechen</button>
            <button className="save-button" disabled={!valid}><Icon name="check" /> {request.mode === "edit" ? "Änderung speichern" : "Ereignis speichern"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
