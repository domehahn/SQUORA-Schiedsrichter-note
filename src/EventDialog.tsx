import { useState } from "react";
import { Icon } from "./icons";
import {
  describePlayer,
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
  hasPriorYellow?: (playerRef: string) => boolean;
  onClose: () => void;
  onSave: (payload: { kind: ActionKind; data: EventInput; timeText: string }) => void;
}

const NUMBER_KINDS = new Set<ActionKind>([
  "goal", "ownGoal", "penaltyGoal", "penaltyMissed", "yellow", "yellowRed", "red", "timePenalty",
]);

const TIME_RE = /^(\d{1,3}):([0-5]?\d)$/;

function optionLabel(player: Player): string {
  if (player.number.trim() && player.name.trim()) return `Nr. ${player.number} · ${player.name}`;
  if (player.number.trim()) return `Nr. ${player.number}`;
  return player.name.trim() || "Ohne Angabe";
}

export function EventDialog({ request, teamLabel, roster, defaultTimeText, hasPriorYellow, onClose, onSave }: Props) {
  const previous = request.event;
  const [player, setPlayer] = useState(previous?.player ?? "");
  const [playerName, setPlayerName] = useState(previous?.playerName ?? "");
  const [playerOut, setPlayerOut] = useState(previous?.playerOut ?? "");
  const [playerOutName, setPlayerOutName] = useState(previous?.playerOutName ?? "");
  const [playerIn, setPlayerIn] = useState(previous?.playerIn ?? "");
  const [playerInName, setPlayerInName] = useState(previous?.playerInName ?? "");
  const [duration, setDuration] = useState(previous?.durationMin ?? (request.action === "timePenalty" ? 5 : 0));
  const [converted, setConverted] = useState(request.action !== "penaltyMissed");
  const [asSecondYellow, setAsSecondYellow] = useState(false);
  const [text, setText] = useState(previous?.text ?? "");
  const [timeText, setTimeText] = useState(previous?.exactTime ?? defaultTimeText);

  const isSub = request.action === "substitution";
  const isNote = request.action === "note";
  const isPenalty = request.action === "penaltyGoal" || request.action === "penaltyMissed";
  const needsNumber = NUMBER_KINDS.has(request.action);

  const hasStatuses = roster.some((entry) => entry.status && entry.status !== "out");
  const nominated = hasStatuses ? roster.filter((entry) => entry.status && entry.status !== "out") : roster;
  const inNominated = (num: string, name: string) =>
    nominated.some((entry) => entry.number.trim() === num.trim() && entry.name.trim() === name.trim() && (num.trim() || name.trim()));
  const [manual, setManual] = useState(
    nominated.length === 0 ||
      (request.mode === "edit" && !isNote && !(isSub
        ? inNominated(previous?.playerOut ?? "", previous?.playerOutName ?? "")
        : inNominated(previous?.player ?? "", previous?.playerName ?? ""))),
  );

  const idOf = (num: string, name: string) =>
    nominated.find((entry) => entry.number.trim() === num.trim() && entry.name.trim() === name.trim())?.id ?? "";

  const has = (num: string, name: string) => Boolean(num.trim() || name.trim());
  const timeValid = TIME_RE.test(timeText.trim());
  const valid = timeValid && (isSub
    ? has(playerOut, playerOutName) && has(playerIn, playerInName)
    : isNote
      ? Boolean(text.trim())
      : needsNumber
        ? has(player, playerName)
        : true);

  const title = request.mode === "edit" ? `${eventMeta[request.action].title} bearbeiten` : eventMeta[request.action].title;
  const secondYellow = request.action === "yellow" && request.mode === "create" && Boolean(hasPriorYellow?.(player.trim() || playerName.trim()));

  const finalName = (num: string, name: string) => name.trim() || rosterName(roster, num);

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
          playerOutName: finalName(playerOut, playerOutName),
          playerIn: playerIn.trim(),
          playerInName: finalName(playerIn, playerInName),
        }
      : isNote
        ? { text: text.trim() }
        : {
            player: player.trim(),
            playerName: finalName(player, playerName),
            ...(request.action === "timePenalty" ? { durationMin: Number(duration) || 0 } : {}),
          };
    onSave({ kind, data, timeText: timeText.trim() });
  };

  const pickerField = (label: string, num: string, name: string, setNum: (value: string) => void, setName: (value: string) => void, autoFocus = false) => {
    if (manual) {
      return (
        <label className="player-field">
          <span>{label}</span>
          <input
            autoFocus={autoFocus}
            list="roster-numbers"
            inputMode="numeric"
            pattern="[A-Za-z0-9\-]+"
            maxLength={4}
            value={num}
            onChange={(event) => { setNum(event.target.value); setName(rosterName(roster, event.target.value)); }}
            placeholder="z. B. 10"
          />
          <small>
            {name ? `→ ${name}` : nominated.length > 0
              ? <button type="button" className="link-button" onClick={() => setManual(false)}>Aus Aufstellung wählen</button>
              : "Name wird aus der Aufstellung übernommen, falls hinterlegt."}
          </small>
        </label>
      );
    }
    return (
      <label className="player-field">
        <span>{label}</span>
        <select
          autoFocus={autoFocus}
          value={idOf(num, name)}
          onChange={(event) => {
            const chosen = nominated.find((entry) => entry.id === event.target.value);
            setNum(chosen?.number ?? "");
            setName(chosen?.name ?? "");
          }}
        >
          <option value="">– Spieler wählen –</option>
          {nominated.map((entry) => <option key={entry.id} value={entry.id}>{optionLabel(entry)}</option>)}
        </select>
        <small><button type="button" className="link-button" onClick={() => setManual(true)}>Nummer manuell eingeben</button></small>
      </label>
    );
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
              {pickerField("Raus", playerOut, playerOutName, setPlayerOut, setPlayerOutName, true)}
              {pickerField("Rein", playerIn, playerInName, setPlayerIn, setPlayerInName)}
            </div>
          ) : isNote ? (
            <label className="player-field">
              <span>Vorkommnis</span>
              <textarea autoFocus rows={3} maxLength={400} value={text} onChange={(event) => setText(event.target.value)} placeholder="z. B. Trinkpause, Behandlung, Zuschauer-Vorfall …" />
              <small>Erscheint in der Tabelle und im Spielbericht.</small>
            </label>
          ) : (
            pickerField("Spieler", player, playerName, setPlayer, setPlayerName, true)
          )}

          {secondYellow && (
            <div className="dialog-warning" role="alert">
              <strong>{describePlayer(player.trim(), playerName.trim())} hat bereits Gelb.</strong>
              <label className="checkbox-field">
                <input type="checkbox" checked={asSecondYellow} onChange={(event) => setAsSecondYellow(event.target.checked)} />
                <span>Als Gelb-Rot (Feldverweis) erfassen</span>
              </label>
            </div>
          )}

          {request.action === "timePenalty" && (
            <label className="player-field">
              <span>Dauer</span>
              <select value={duration} onChange={(event) => setDuration(Number(event.target.value))}>
                {[1, 2, 3, 5, 8, 10, 15].map((minutes) => <option key={minutes} value={minutes}>{minutes} Minuten</option>)}
              </select>
            </label>
          )}

          {isPenalty && (
            <label className="checkbox-field">
              <input type="checkbox" checked={converted} onChange={(event) => setConverted(event.target.checked)} />
              <span>Elfmeter verwandelt</span>
            </label>
          )}

          <details className="time-override" open={request.mode === "edit"}>
            <summary>Zeitpunkt anpassen</summary>
            <label className="player-field">
              <span>Spielzeit (MM:SS)</span>
              <input inputMode="numeric" value={timeText} onChange={(event) => setTimeText(event.target.value)} placeholder="z. B. 42:15" aria-invalid={!timeValid} />
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
