#!/usr/bin/env node
// Lightweight, low-noise guard against real personal data landing in Git.
// Scans the FULL history (all reachable commits) for two things:
//   1. free-mail addresses (gmail/gmx/web.de/…) — almost always a real person
//   2. DFBnet roster exports carrying identity columns outside test fixtures
// Known, already-assessed findings are listed in ACKNOWLEDGED and downgraded to
// a warning (see docs/security/GIT_HISTORY_PII_RESPONSE.md). Anything new fails.

import { execFileSync } from "node:child_process";

const git = (args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/** Findings that have been reviewed and accepted; matched as plain substrings. */
const ACKNOWLEDGED = [
  "dominik87hahn@gmail.com", // repo owner's own address, pre-D1 commits, see runbook
];

// POSIX ERE (git grep -E): no (?:) groups, no {n,} quantifiers.
const FREE_MAIL = "[a-zA-Z0-9._%+-]+@(gmail|googlemail|web|gmx|outlook|hotmail|yahoo|ymail|icloud|t-online|freenet|aol|proton|protonmail)\\.[a-z]+";
// Unambiguous DFBnet roster-export column headers — never part of normal prose.
const DFBNET_COLUMNS = "(Spielrecht ab|Spielberechtigung ab|Reg\\. am|Passnr\\.;)";
const TEST_PATH = /(\.test\.ts$|^cloudflare\/test\/|^tests\/|^scripts\/check-pii-history\.mjs$|^\.gitleaks\.toml$|^docs\/security\/GIT_HISTORY_PII_RESPONSE\.md$)/;

const revs = git(["rev-list", "--all"]).split("\n").filter(Boolean);
const problems = [];
const acknowledged = [];

function scan(pattern, { pathFilter } = {}) {
  let out = "";
  try {
    out = git(["grep", "-InE", pattern, ...revs]);
  } catch {
    return; // git grep exits 1 when nothing matches
  }
  for (const line of out.split("\n").filter(Boolean)) {
    // format: <rev>:<path>:<lineno>:<text>
    const match = /^([0-9a-f]{7,40}):([^:]+):(\d+):(.*)$/.exec(line);
    if (!match) continue;
    const [, rev, path, , text] = match;
    if (pathFilter && !pathFilter(path)) continue;
    if (ACKNOWLEDGED.some((a) => text.includes(a))) { acknowledged.push(`${rev.slice(0, 10)} ${path}`); continue; }
    problems.push(`${rev.slice(0, 10)}  ${path}\n    ${text.trim().slice(0, 160)}`);
  }
}

scan(FREE_MAIL, { pathFilter: (p) => !TEST_PATH.test(p) });
scan(DFBNET_COLUMNS, { pathFilter: (p) => !TEST_PATH.test(p) });

if (acknowledged.length > 0) {
  const uniq = [...new Set(acknowledged)];
  console.log(`::notice::${uniq.length} acknowledged PII occurrence(s) in history (see docs/security/GIT_HISTORY_PII_RESPONSE.md):`);
  for (const entry of uniq.slice(0, 20)) console.log(`  ${entry}`);
}

if (problems.length > 0) {
  const uniq = [...new Set(problems)];
  console.error(`::error::${uniq.length} unreviewed personal-data occurrence(s) found in Git history:`);
  for (const entry of uniq) console.error(entry);
  console.error("\nIf this is synthetic test data, adjust the fixture to the documented convention");
  console.error("(Max Testspieler / Anna Beispiel / @example.invalid / 0100-0001).");
  console.error("If it is real, follow docs/security/GIT_HISTORY_PII_RESPONSE.md.");
  process.exit(1);
}

console.log("PII history guard: clean (no unreviewed personal data).");
