import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./csv";

describe("csv hardening", () => {
  it("quotes and escapes normal values", () => {
    expect(csvCell("SV Blau")).toBe('"SV Blau"');
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvCell(3)).toBe('"3"');
    expect(csvCell(null)).toBe('""');
  });

  it("neutralises spreadsheet formula injection", () => {
    expect(csvCell("=1+1")).toBe(`"'=1+1"`);
    expect(csvCell("+HYPERLINK(1)")).toBe(`"'+HYPERLINK(1)"`);
    expect(csvCell("-2+3")).toBe(`"'-2+3"`);
    expect(csvCell("@SUM(A1:A9)")).toBe(`"'@SUM(A1:A9)"`);
    expect(csvCell("\tinjected")).toBe(`"'\tinjected"`);
  });

  it("emits a BOM and CRLF rows", () => {
    const out = toCsv([["a", "b"], ["=x", 2]]);
    expect(out.startsWith("﻿")).toBe(true);
    expect(out).toBe('﻿"a";"b"\r\n"\'=x";"2"');
  });
});
