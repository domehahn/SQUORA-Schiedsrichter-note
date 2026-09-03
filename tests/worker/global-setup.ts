import { execFileSync } from "node:child_process";
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const PERSIST_DIR = ".wrangler-e2e";
export const DB_NAME = "schiedsrichter-note-development";

/** Synthetic accounts + a foreign tenant, seeded straight into the local D1. */
export const E2E = {
  userA: { id: "e2e0a000-0000-4000-8000-0000000000a1", email: "referee-a@e2e.invalid", password: "e2e-passphrase-aaaa" },
  userB: { id: "e2e0b000-0000-4000-8000-0000000000b1", email: "referee-b@e2e.invalid", password: "e2e-passphrase-bbbb" },
  clubB: "e2e0b000-0000-4000-8000-00000000c1b0",
  teamB: "e2e0b000-0000-4000-8000-00000000d1b0",
} as const;

function hash(password: string): string {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(password, salt, 100_000, 32, "sha256");
  return `pbkdf2-sha256$100000$${salt.toString("hex")}$${derived.toString("hex")}`;
}

function wrangler(args: string[]): void {
  execFileSync("npx", ["wrangler", ...args], { stdio: "inherit" });
}

export default function globalSetup(): void {
  execFileSync("npm", ["run", "build"], { stdio: "inherit" });
  rmSync(PERSIST_DIR, { recursive: true, force: true });

  wrangler(["d1", "migrations", "apply", DB_NAME, "--local", "--persist-to", PERSIST_DIR, "--env", "development"]);

  const now = new Date().toISOString();
  const rows = [
    `INSERT INTO users (id,email,display_name,password_hash,status,created_at,updated_at) VALUES ('${E2E.userA.id}','${E2E.userA.email}','Referee A','${hash(E2E.userA.password)}','active','${now}','${now}');`,
    `INSERT INTO users (id,email,display_name,password_hash,status,created_at,updated_at) VALUES ('${E2E.userB.id}','${E2E.userB.email}','Referee B','${hash(E2E.userB.password)}','active','${now}','${now}');`,
    `INSERT INTO clubs (id,name,slug,cache_salt,status,created_at,updated_at) VALUES ('${E2E.clubB}','Foreign Club B','foreign-club-b','AAAAAAAAAAAAAAAAAAAAAA==','active','${now}','${now}');`,
    `INSERT INTO memberships (club_id,user_id,role,status,created_at,updated_at) VALUES ('${E2E.clubB}','${E2E.userB.id}','club_owner','active','${now}','${now}');`,
    `INSERT INTO teams (club_id,id,name,age_group,version,created_at,updated_at) VALUES ('${E2E.clubB}','${E2E.teamB}','B E1','E',1,'${now}','${now}');`,
  ].join("\n");
  const file = join(mkdtempSync(join(tmpdir(), "squora-e2e-")), "seed.sql");
  writeFileSync(file, rows);
  wrangler(["d1", "execute", DB_NAME, "--local", "--persist-to", PERSIST_DIR, "--env", "development", "--file", file]);
}
