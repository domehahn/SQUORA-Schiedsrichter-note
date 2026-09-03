import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DB_NAME, E2E, PERSIST_DIR, hashPassword } from "./fixtures.ts";

if (!existsSync("dist/index.html")) {
  throw new Error("dist/ is missing — run `npm run build` first.");
}

function wrangler(args) {
  execFileSync("npx", ["wrangler", ...args], { stdio: "inherit" });
}

rmSync(PERSIST_DIR, { recursive: true, force: true });
wrangler(["d1", "migrations", "apply", DB_NAME, "--local", "--persist-to", PERSIST_DIR, "--env", "development"]);

const now = new Date().toISOString();
const sql = [
  `INSERT INTO users (id,email,display_name,password_hash,status,created_at,updated_at) VALUES ('${E2E.userA.id}','${E2E.userA.email}','Referee A','${hashPassword(E2E.userA.password)}','active','${now}','${now}');`,
  `INSERT INTO users (id,email,display_name,password_hash,status,created_at,updated_at) VALUES ('${E2E.userB.id}','${E2E.userB.email}','Referee B','${hashPassword(E2E.userB.password)}','active','${now}','${now}');`,
  `INSERT INTO clubs (id,name,slug,cache_salt,status,created_at,updated_at) VALUES ('${E2E.clubB}','Foreign Club B','foreign-club-b','AAAAAAAAAAAAAAAAAAAAAA==','active','${now}','${now}');`,
  `INSERT INTO memberships (club_id,user_id,role,status,created_at,updated_at) VALUES ('${E2E.clubB}','${E2E.userB.id}','club_owner','active','${now}','${now}');`,
  `INSERT INTO teams (club_id,id,name,age_group,version,created_at,updated_at) VALUES ('${E2E.clubB}','${E2E.teamB}','B E1','E',1,'${now}','${now}');`,
].join("\n");
const file = join(mkdtempSync(join(tmpdir(), "squora-e2e-")), "seed.sql");
writeFileSync(file, sql);
wrangler(["d1", "execute", DB_NAME, "--local", "--persist-to", PERSIST_DIR, "--env", "development", "--file", file]);

console.log("e2e-worker: local D1 migrated and seeded");
