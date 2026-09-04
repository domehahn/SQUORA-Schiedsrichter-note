import { describe, expect, it } from "vitest";
import { FORMATION_SIZES, findFormation, formationSlots, formationsForSize, nearestFormation } from "./formations";

describe("formations", () => {
  it("every formation's slot count matches its declared size (GK + outfield lines)", () => {
    for (const size of FORMATION_SIZES) {
      for (const formation of formationsForSize(size)) {
        const slots = formationSlots(formation);
        expect(slots).toHaveLength(size);
        expect(new Set(slots.map((slot) => slot.key)).size).toBe(size); // unique keys
        expect(slots.every((slot) => slot.x >= 0 && slot.x <= 100 && slot.y >= 0 && slot.y <= 100)).toBe(true);
        expect(formation.lines.reduce((sum, n) => sum + n, 0)).toBe(size - 1);
      }
    }
  });

  it("keeps the goalkeeper slot fixed near the own goal, centred", () => {
    const formation = findFormation("4-4-2")!;
    const [gk] = formationSlots(formation);
    expect(gk).toMatchObject({ key: "GK", x: 50 });
    expect(gk.y).toBeGreaterThan(80);
  });

  it("picks a formation whose size is closest to the starter count", () => {
    expect(nearestFormation(9).size).toBe(9);
    expect(nearestFormation(6).size).toBe(7);
    expect(nearestFormation(20).size).toBe(11);
  });

  it("findFormation is undefined for an unknown id", () => {
    expect(findFormation("9-9-9")).toBeUndefined();
  });
});
