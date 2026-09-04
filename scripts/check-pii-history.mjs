#!/usr/bin/env node
// Lightweight, low-noise guard against real personal data landing in Git.
// Scans the FULL history (all reachable commits) for two things:
//   1. free-mail addresses (gmail/gmx/web.de/…) — almost always a real person
//   2. DFBnet roster exports carrying identity columns
// Both scans run over the WHOLE tree, test fixtures included: a *.test.ts
// file is exactly where a careless copy-paste of a real DFBnet export could
// hide unnoticed. Instead of exempting test paths wholesale, a DFBnet-header
// hit is only treated as a non-issue when the data rows around it actually
// follow the project's documented synthetic-fixture convention (see
// docs/security/GIT_HISTORY_PII_RESPONSE.md and CLAUDE.md); anything that
// doesn't is reported for manual assessment.
// Known, already-assessed findings are listed in ACKNOWLEDGED and downgraded to
// a warning. Anything new fails.

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
// This scanner's own source and the runbook that documents these patterns as
// literal examples — self-references, not fixtures, would otherwise flag
// themselves every run. This is the ONLY path exemption; test paths are
// scanned like everything else.
const SELF_REFERENCE = /(^scripts\/check-pii-history\.mjs$|^\.gitleaks\.toml$|^docs\/security\/GIT_HISTORY_PII_RESPONSE\.md$)/;

// Documented synthetic-fixture convention (see CLAUDE.md / the runbook). A
// DFBnet-shaped row is only accepted as a fixture when it carries these
// markers; a plausible-looking real name/date/pass-number combination next
// to real DFBnet headers is reported instead.
const SYNTHETIC_NAME_MARKERS = ["Testspieler", "Beispiel", "Musterkind", "Mustermann", "Test-", "SV Testverein", "FC Beispielstadt"];
// Birthdate convention actually in use across fixtures: day == month
// (01.01, 02.02, 03.03, …) — a repeated-digit date is not a real birthdate.
const SYNTHETIC_DATE = /\b(\d{2})\.\1\.(19|20)\d{2}\b/;
const SYNTHETIC_PASS = /\b0100-000\d\b/;
const ANY_DATE = /\b\d{2}\.\d{2}\.(19|20)\d{2}\b/;
const ANY_PASS = /\b\d{4}-\d{4}\b/;
const HEADER_MARKER = /Geb\.|Geburtsdatum/;

const revs = git(["rev-list", "--all"]).split("\n").filter(Boolean);
const problems = [];
const acknowledged = [];

function scan(pattern, { pathFilter, classify } = {}) {
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
    if (classify && classify(rev, path, text) === "synthetic") continue;
    problems.push(`${rev.slice(0, 10)}  ${path}\n    ${text.trim().slice(0, 160)}`);
  }
}

/**
 * A DFBnet-header hit is only "synthetic" when the file at that revision
 * follows the documented fixture convention: it carries a known synthetic
 * name/club marker, its birthdate column (found via the "Geb."/"Geburtsdatum"
 * header) only ever holds repeated-digit dates, and any pass number matches
 * 0100-000x. Administrative dates (Spielrecht ab / Reg. am) are not
 * birthdates and are not checked. Fixtures embed rows either as real
 * newlines (multi-line array/template literal) or as an escaped "\n" inside
 * a single string literal, so both are split out before inspection. Anything
 * that doesn't clear this bar — a realistic name, a real-looking birthdate —
 * is reported regardless of path, which is exactly the "realistic data
 * slipped into a test fixture" case this scanner exists to catch.
 */
function classifyDfbnetHit(rev, path) {
  let content;
  try {
    content = git(["show", `${rev}:${path}`]);
  } catch {
    return "unknown"; // couldn't read the blob (binary, deleted, etc.) — don't suppress
  }
  if (!SYNTHETIC_NAME_MARKERS.some((m) => content.includes(m))) return "unknown";

  const rows = content.split(/\r?\n/).flatMap((line) => line.split("\\n"));
  const headerRow = rows.find((r) => HEADER_MARKER.test(r) && r.includes(";"));
  const birthdateCol = headerRow ? headerRow.split(";").findIndex((c) => HEADER_MARKER.test(c)) : -1;

  for (const row of rows) {
    if (!row.includes(";")) continue;
    const cols = row.split(";");
    const birthdate = birthdateCol >= 0 ? (cols[birthdateCol]?.match(ANY_DATE)?.[0] ?? null) : null;
    if (birthdate && !SYNTHETIC_DATE.test(birthdate)) return "unknown";
    for (const pass of row.match(new RegExp(ANY_PASS, "g")) ?? []) {
      if (!SYNTHETIC_PASS.test(pass)) return "unknown";
    }
  }
  return "synthetic";
}

scan(FREE_MAIL, { pathFilter: (p) => !SELF_REFERENCE.test(p) });
scan(DFBNET_COLUMNS, { pathFilter: (p) => !SELF_REFERENCE.test(p), classify: classifyDfbnetHit });

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
  console.error("(Max Testspieler / Anna Beispiel / @example.invalid / 0100-0001 / 01.01.2014 or 02.02.2015).");
  console.error("If it is real, follow docs/security/GIT_HISTORY_PII_RESPONSE.md.");
  process.exit(1);
}

console.log("PII history guard: clean (no unreviewed personal data, test fixtures included).");
