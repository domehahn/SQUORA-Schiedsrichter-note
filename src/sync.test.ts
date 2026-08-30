import { describe, expect, it } from "vitest";
import { createMatch, type SavedMatch } from "./match";
import { applyDeletions, mergeArchives, sanitizeArchive } from "./sync";

function saved(id: string, savedAt: string): SavedMatch {
  return { savedAt, state: createMatch({ id }) };
}

describe("mergeArchives", () => {
  it("dedupliziert nach Match-ID und behält den neueren Speicherstand", () => {
    const local = [saved("a", "2026-08-30T10:00:00Z"), saved("b", "2026-08-29T10:00:00Z")];
    const remote = [saved("a", "2026-08-30T12:00:00Z"), saved("c", "2026-08-28T10:00:00Z")];
    const merged = mergeArchives(local, remote);
    expect(merged.map((entry) => entry.state.id).sort()).toEqual(["a", "b", "c"]);
    expect(merged.find((entry) => entry.state.id === "a")!.savedAt).toBe("2026-08-30T12:00:00Z");
    // neueste zuerst
    expect(merged[0].state.id).toBe("a");
  });
});

describe("applyDeletions", () => {
  it("entfernt getombstonete Einträge", () => {
    const list = [saved("a", "x"), saved("b", "y")];
    expect(applyDeletions(list, ["b"]).map((entry) => entry.state.id)).toEqual(["a"]);
  });
});

describe("sanitizeArchive", () => {
  it("verwirft kaputte Einträge und normalisiert die Reststände", () => {
    const result = sanitizeArchive([
      { savedAt: "x", state: { version: 1, id: "ok", events: [] } },
      { nope: true },
      42,
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].state.version).toBe(2);
    expect(result[0].state.meta).toBeDefined();
  });
});
