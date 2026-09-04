import { uid, type Player } from "./match";
import { mapRoster, teamNameFromFilename } from "./integrations/dfbnet/mapper";
import { parseCsv } from "./integrations/dfbnet/parser";
import { DFBNET_LIMITS } from "./integrations/dfbnet/schema";
import { DfbnetValidationError } from "./integrations/dfbnet/validator";

export { teamNameFromFilename };

export interface DfbnetImport {
  players: Player[];
  teamName: string;
  warnings: string[];
}

export interface ExternalRosterEntry {
  name: string;
  firstName: string;
  shirtNumber: string;
  externalId: string;
}

/** Parses a DFBnet CSV to the minimal fields the server relational import accepts (keeps externalId). */
export function parseDfbnetExternal(csv: string, filename = "import.csv"): { teamName: string; warnings: string[]; players: ExternalRosterEntry[] } {
  if (new TextEncoder().encode(csv).byteLength > DFBNET_LIMITS.maxFileBytes) throw new DfbnetValidationError("FILE_TOO_LARGE");
  const external = mapRoster(parseCsv(csv), filename || "import.csv");
  return {
    teamName: external.teamName,
    warnings: external.warnings,
    players: external.players.map((player) => ({
      name: player.name,
      firstName: player.firstName ?? "",
      shirtNumber: player.shirtNumber ?? "",
      externalId: player.externalId ?? "",
    })),
  };
}

/** Compatibility facade for the UI; the DFBnet adapter itself is UI-independent. */
export function parseDfbnetRoster(csv: string, filename = "import.csv"): DfbnetImport {
  if (new TextEncoder().encode(csv).byteLength > DFBNET_LIMITS.maxFileBytes) throw new DfbnetValidationError("FILE_TOO_LARGE");
  const external = mapRoster(parseCsv(csv), filename || "import.csv");
  return {
    teamName: external.teamName,
    warnings: external.warnings,
    players: external.players.map((player) => ({
      id: uid(),
      number: player.shirtNumber,
      name: player.name,
      pass: player.pass ?? "",
      birthdate: player.birthdate ?? "",
      status: "out" as const,
    })),
  };
}
