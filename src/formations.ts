/**
 * Formation catalog for the pitch view. A formation is a goalkeeper plus a list
 * of outfield lines (defence → attack); slot coordinates are generated, not
 * hand-placed, so adding a formation is just one line. `size` is the total
 * players on the pitch (GK + outfield), matching common youth-football formats
 * (5/7/9-a-side) as well as full 11-a-side.
 */
export interface Formation {
  id: string;
  label: string;
  size: number;
  lines: number[];
}

export interface FormationSlot {
  key: string;
  label: string;
  x: number;
  y: number;
}

export const FORMATION_SIZES = [5, 7, 9, 11] as const;

const CATALOG: Formation[] = [
  { id: "4-4-2", label: "4-4-2", size: 11, lines: [4, 4, 2] },
  { id: "4-3-3", label: "4-3-3", size: 11, lines: [4, 3, 3] },
  { id: "4-2-3-1", label: "4-2-3-1", size: 11, lines: [4, 2, 3, 1] },
  { id: "3-5-2", label: "3-5-2", size: 11, lines: [3, 5, 2] },
  { id: "5-3-2", label: "5-3-2", size: 11, lines: [5, 3, 2] },
  { id: "3-3-2", label: "3-3-2", size: 9, lines: [3, 3, 2] },
  { id: "3-2-3", label: "3-2-3", size: 9, lines: [3, 2, 3] },
  { id: "2-4-2", label: "2-4-2", size: 9, lines: [2, 4, 2] },
  { id: "3-2-1", label: "3-2-1", size: 7, lines: [3, 2, 1] },
  { id: "2-3-1", label: "2-3-1", size: 7, lines: [2, 3, 1] },
  { id: "3-1-2", label: "3-1-2", size: 7, lines: [3, 1, 2] },
  { id: "2-2", label: "2-2", size: 5, lines: [2, 2] },
  { id: "1-3", label: "1-3", size: 5, lines: [1, 3] },
];

export function formationsForSize(size: number): Formation[] {
  return CATALOG.filter((formation) => formation.size === size);
}

export function findFormation(id: string): Formation | undefined {
  return CATALOG.find((formation) => formation.id === id);
}

/** The formation catalog entry whose outfield-count best matches a starter count (for picking a sane default). */
export function nearestFormation(starterCount: number): Formation {
  const bySizeDiff = [...CATALOG].sort((a, b) => Math.abs(a.size - starterCount) - Math.abs(b.size - starterCount));
  return bySizeDiff[0];
}

/** Full German names for every chip shown, keyed by its abbreviation (used as a tooltip). */
export const POSITION_NAMES: Record<string, string> = {
  TW: "Torwart", LV: "Linksverteidigung", IV: "Innenverteidigung", RV: "Rechtsverteidigung",
  LM: "Linkes Mittelfeld", ZM: "Zentrales Mittelfeld", RM: "Rechtes Mittelfeld",
  LA: "Linksaußen", ST: "Sturm", RA: "Rechtsaußen",
};

/** Left-to-right role names for one line, by its role (defence/midfield/attack) and player count. */
function lineLabels(lineIndex: number, lineCount: number, size: number): string[] {
  const isDefence = lineIndex === 0;
  const isAttack = lineIndex === lineCount - 1;
  if (isDefence) {
    if (size <= 1) return ["IV"];
    if (size === 2) return ["IV", "IV"];
    if (size === 3) return ["LV", "IV", "RV"];
    if (size === 4) return ["LV", "IV", "IV", "RV"];
    return ["LV", "IV", "IV", "IV", "RV"];
  }
  if (isAttack) {
    if (size <= 1) return ["ST"];
    if (size === 2) return ["ST", "ST"];
    return ["LA", "ST", "RA"];
  }
  if (size <= 1) return ["ZM"];
  if (size === 2) return ["ZM", "ZM"];
  if (size === 3) return ["LM", "ZM", "RM"];
  if (size === 4) return ["LM", "ZM", "ZM", "RM"];
  return ["LM", "ZM", "ZM", "ZM", "RM"];
}

/** Goalkeeper plus one slot per outfield player, percentage coordinates (x: 0 left – 100 right, y: 0 attacking end – 100 own goal). */
export function formationSlots(formation: Formation): FormationSlot[] {
  const slots: FormationSlot[] = [{ key: "GK", label: "TW", x: 50, y: 94 }];
  const lineCount = formation.lines.length;
  formation.lines.forEach((count, lineIndex) => {
    const y = lineCount === 1 ? 45 : 78 - lineIndex * (66 / (lineCount - 1));
    const labels = lineLabels(lineIndex, lineCount, count);
    const totalByLabel = new Map<string, number>();
    for (const label of labels) totalByLabel.set(label, (totalByLabel.get(label) ?? 0) + 1);
    const seenByLabel = new Map<string, number>();
    labels.forEach((label, i) => {
      const occurrence = (seenByLabel.get(label) ?? 0) + 1;
      seenByLabel.set(label, occurrence);
      const displayLabel = totalByLabel.get(label)! > 1 ? `${label}${occurrence}` : label;
      const x = ((i + 1) / (count + 1)) * 100;
      slots.push({ key: `L${lineIndex}-${i}`, label: displayLabel, x, y });
    });
  });
  return slots;
}
