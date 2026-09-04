import { describe, expect, it } from "vitest";
import { decodeCsvBytes } from "./decode";

const bytes = (...values: number[]) => new Uint8Array(values).buffer;

describe("decodeCsvBytes", () => {
  it("keeps umlauts from a Windows-1252 encoded export", () => {
    // "Müller;Groß" in Windows-1252 (0xFC = ü, 0xDF = ß)
    const win1252 = bytes(0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72, 0x3b, 0x47, 0x72, 0x6f, 0xdf);
    expect(decodeCsvBytes(win1252)).toBe("Müller;Groß");
  });

  it("reads a UTF-8 export unchanged", () => {
    expect(decodeCsvBytes(new TextEncoder().encode("Müller;Groß").buffer)).toBe("Müller;Groß");
  });

  it("strips a UTF-8 BOM", () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("Wört")]);
    expect(decodeCsvBytes(withBom.buffer)).toBe("Wört");
  });
});
