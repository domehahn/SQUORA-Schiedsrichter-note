import { describe, expect, it } from "vitest";
import { createSavedTeam, mergeTeams, sanitizeTeams } from "./teams";

describe("teams library", () => {
  it("normalisiert Kader und verwirft Müll", () => {
    const result = sanitizeTeams([
      { id: "t1", name: "SV Blau", club: "e.V.", roster: [{ number: "7", name: "Meier" }, { number: "", name: "" }] },
      { nope: true },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].roster).toHaveLength(1);
    expect(result[0].roster[0].id).toBeTypeOf("string");
  });

  it("behält je ID die zuletzt geänderte Fassung", () => {
    const older = { ...createSavedTeam("Alt"), id: "t1", updatedAt: "2026-08-01T00:00:00.000Z" };
    const newer = { ...createSavedTeam("Neu"), id: "t1", updatedAt: "2026-08-30T00:00:00.000Z" };
    const merged = mergeTeams([older], [newer]);
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe("Neu");
  });
});
