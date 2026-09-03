export interface ExternalPlayer {
  externalId?: string;
  firstName: string;
  lastName: string;
  name: string;
  shirtNumber: string;
  /** Local-only identity-verification aids (Spielberechtigung). Never persisted server-side; see docs/privacy/DFBNET_DATA_HANDLING.md. */
  pass?: string;
  birthdate?: string;
}

export interface ExternalRoster {
  provider: "dfbnet_csv";
  teamName: string;
  players: ExternalPlayer[];
  warnings: string[];
}

export interface RosterProvider {
  parse(input: ArrayBuffer, filename: string): Promise<ExternalRoster>;
}

