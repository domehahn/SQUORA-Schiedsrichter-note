import { pbkdf2Sync, randomBytes } from "node:crypto";

export const PERSIST_DIR = ".wrangler-e2e";
export const DB_NAME = "schiedsrichter-note-development";
export const PORT = 8788;

/** Synthetic accounts + a foreign tenant, seeded straight into the local D1. */
export const E2E = {
  userA: { id: "e2e0a000-0000-4000-8000-0000000000a1", email: "referee-a@e2e.invalid", password: "e2e-passphrase-aaaa" },
  userB: { id: "e2e0b000-0000-4000-8000-0000000000b1", email: "referee-b@e2e.invalid", password: "e2e-passphrase-bbbb" },
  clubB: "e2e0b000-0000-4000-8000-00000000c1b0",
  teamB: "e2e0b000-0000-4000-8000-00000000d1b0",
} as const;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(password, salt, 100_000, 32, "sha256");
  return `pbkdf2-sha256$100000$${salt.toString("hex")}$${derived.toString("hex")}`;
}
