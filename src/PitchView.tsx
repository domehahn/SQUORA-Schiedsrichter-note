import { useState } from "react";
import { findFormation, formationSlots, formationsForSize, nearestFormation, FORMATION_SIZES, type FormationSlot } from "./formations";
import type { Player } from "./match";

interface Props {
  teamLabel: string;
  roster: Player[];
  formationId: string;
  onFormationChange: (id: string) => void;
  onAssign: (playerId: string, slotKey: string | null) => void;
}

/** Pitch sketch: pick a formation, tap a slot, assign one of the "aufgestellt" players to it. */
export function PitchView({ teamLabel, roster, formationId, onFormationChange, onAssign }: Props) {
  const [activeSlot, setActiveSlot] = useState<string | null>(null);
  const starters = roster.filter((player) => (player.status ?? "out") === "start");
  const formation = findFormation(formationId) ?? nearestFormation(starters.length || 11);
  const slots = formationSlots(formation);
  const bySlot = new Map(starters.filter((player) => player.position).map((player) => [player.position!, player]));
  const unplaced = starters.filter((player) => !slots.some((slot) => slot.key === player.position));

  if (starters.length === 0) {
    return <p className="collapsible-hint">Noch niemand „Aufgestellt" – dort markierte Spieler erscheinen hier auf dem Feld.</p>;
  }

  const active = slots.find((slot) => slot.key === activeSlot) ?? null;
  const occupant = active ? bySlot.get(active.key) ?? null : null;

  return (
    <div className="pitch-view">
      <div className="pitch-tools">
        <label>
          <span>Formation</span>
          <select value={formation.id} onChange={(event) => { onFormationChange(event.target.value); setActiveSlot(null); }}>
            {FORMATION_SIZES.map((size) => {
              const options = formationsForSize(size);
              if (options.length === 0) return null;
              return (
                <optgroup key={size} label={`${size}er`}>
                  {options.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
                </optgroup>
              );
            })}
          </select>
        </label>
      </div>

      <div className="pitch" role="group" aria-label={`Aufstellung ${teamLabel}`}>
        <div className="pitch-lines" aria-hidden="true" />
        {slots.map((slot: FormationSlot) => {
          const player = bySlot.get(slot.key);
          return (
            <button
              key={slot.key}
              type="button"
              className={`pitch-slot ${player ? "filled" : "empty"} ${activeSlot === slot.key ? "active" : ""}`}
              style={{ left: `${slot.x}%`, top: `${slot.y}%` }}
              onClick={() => setActiveSlot((current) => (current === slot.key ? null : slot.key))}
              aria-label={`Position ${slot.label}${player ? `: ${player.name || player.number}` : " frei"}`}
            >
              <span className="pitch-slot-num">{player ? player.number || "–" : slot.label}</span>
              {player && <span className="pitch-slot-name">{player.name.split(" ").at(-1) ?? player.name}</span>}
            </button>
          );
        })}
      </div>

      {active && (
        <div className="pitch-assign">
          <span>Position {active.label}:</span>
          <select
            value={occupant?.id ?? ""}
            onChange={(event) => { onAssign(event.target.value, active.key); if (event.target.value) setActiveSlot(null); }}
          >
            <option value="">frei</option>
            {starters.map((player) => (
              <option key={player.id} value={player.id}>{player.number ? `#${player.number} ` : ""}{player.name || "Unbenannt"}</option>
            ))}
          </select>
          {occupant && <button type="button" className="mini-icon danger" aria-label="Position leeren" onClick={() => { onAssign(occupant.id, null); setActiveSlot(null); }}>×</button>}
        </div>
      )}

      {unplaced.length > 0 && (
        <p className="collapsible-hint">Ohne Position: {unplaced.map((player) => player.name || `#${player.number}`).join(", ")}</p>
      )}
    </div>
  );
}
