import { mapRoster } from "./mapper";
import { parseCsv } from "./parser";
import type { ExternalRoster, RosterProvider } from "./types";
import { validateFile } from "./validator";

export class DfbnetCsvProvider implements RosterProvider {
  async parse(input: ArrayBuffer, filename: string): Promise<ExternalRoster> {
    validateFile(input, filename);
    return mapRoster(parseCsv(new TextDecoder("utf-8", { fatal: false }).decode(input)), filename);
  }
}

