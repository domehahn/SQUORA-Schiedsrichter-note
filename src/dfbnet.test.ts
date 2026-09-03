import { describe, expect, it } from "vitest";
import { parseDfbnetRoster, teamNameFromFilename } from "./dfbnet";

const SAMPLE = `Name Künstlername;Vorname Rufname;Geb.;Nat.;Passnummer;Spielrecht ab;Reg. am
Testspieler ;Max (m) ;01.01.2014;XX;0100-0001;P 01.01.2026 F 01.01.2026;02.01.2026
Beispiel ;Anna (w) ;02.02.2014;XX;0100-0002;P 02.01.2026 F 02.01.2026;03.01.2026
Musterkind ;Kim (d) ;03.03.2015;XX;0100-0003;P 03.01.2026 F 03.01.2026;04.01.2026
`;

describe("parseDfbnetRoster", () => {
  it("liest Namen aus dem DFBnet-Export, ohne Rückennummern", () => {
    const { players } = parseDfbnetRoster(SAMPLE, "FC_Beispielstadt_II-20260903.csv");
    expect(players).toHaveLength(3);
    expect(players[0]).toMatchObject({ number: "", name: "Max Testspieler" });
    expect(players[1].name).toBe("Anna Beispiel");
    expect(players[2].name).toBe("Kim Musterkind");
    expect(players.every((player) => typeof player.id === "string" && player.id.length > 0)).toBe(true);
  });

  it("übernimmt eine Rückennummern-Spalte, wenn vorhanden", () => {
    const csv = "Nr.;Name;Vorname\n7;Meier;Anna (w)\n11;Kern;Ben";
    const { players } = parseDfbnetRoster(csv);
    expect(players).toEqual([
      expect.objectContaining({ number: "7", name: "Anna Meier" }),
      expect.objectContaining({ number: "11", name: "Ben Kern" }),
    ]);
  });

  it("leitet den Vereinsnamen aus dem Dateinamen ab", () => {
    expect(teamNameFromFilename("FC_Beispielstadt_II-20260903.csv")).toBe("FC Beispielstadt II");
    expect(teamNameFromFilename("SV Blau 2026-09-03.csv")).toBe("SV Blau");
  });
});
