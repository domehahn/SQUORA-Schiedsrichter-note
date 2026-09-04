import { useId, useState } from "react";
import { findFormation, formationSlots, formationsForSize, nearestFormation, FORMATION_SIZES, type FormationSlot } from "./formations";
import type { Player } from "./match";

const LINE = { stroke: "rgba(255,255,255,.65)", strokeWidth: 0.7, fill: "none" } as const;

/** Regulation pitch markings (goal, 5m/6-yard box, 16m/penalty box, penalty arc, centre circle), scaled to the 100×150 viewBox. */
function PitchMarkings() {
  const uid = useId(); // two pitches (home + away) render at once — clipPath ids must not collide
  const topArc = `${uid}-top`;
  const bottomArc = `${uid}-bottom`;
  return (
    <svg className="pitch-lines" viewBox="0 0 100 150" aria-hidden="true">
      <clipPath id={topArc}><rect x="0" y="25.6" width="100" height="150" /></clipPath>
      <clipPath id={bottomArc}><rect x="0" y="0" width="100" height="124.4" /></clipPath>
      <rect x="2" y="2" width="96" height="146" {...LINE} />
      <line x1="2" y1="75" x2="98" y2="75" {...LINE} />
      <circle cx="50" cy="75" r="13" {...LINE} />
      <circle cx="50" cy="75" r="0.8" fill="rgba(255,255,255,.65)" stroke="none" />
      {/* top end (own goal) */}
      <rect x="20.4" y="2" width="59.2" height="23.6" {...LINE} />
      <rect x="36.55" y="2" width="26.9" height="7.9" {...LINE} />
      <rect x="44.6" y="-1" width="10.8" height="3" fill="rgba(255,255,255,.85)" stroke="rgba(255,255,255,.65)" strokeWidth="0.4" />
      <circle cx="50" cy="17.7" r="0.8" fill="rgba(255,255,255,.65)" stroke="none" />
      <circle cx="50" cy="17.7" r="13.4" clipPath={`url(#${topArc})`} {...LINE} />
      {/* bottom end (attacking goal) */}
      <rect x="20.4" y="124.4" width="59.2" height="23.6" {...LINE} />
      <rect x="36.55" y="140.1" width="26.9" height="7.9" {...LINE} />
      <rect x="44.6" y="148" width="10.8" height="3" fill="rgba(255,255,255,.85)" stroke="rgba(255,255,255,.65)" strokeWidth="0.4" />
      <circle cx="50" cy="132.3" r="0.8" fill="rgba(255,255,255,.65)" stroke="none" />
      <circle cx="50" cy="132.3" r="13.4" clipPath={`url(#${bottomArc})`} {...LINE} />
    </svg>
  );
}

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
        <PitchMarkings />
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
