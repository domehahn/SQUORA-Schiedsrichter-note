import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../dist/sw.js", import.meta.url), "utf8");
const failures = [];

if (!source.includes("NetworkOnly")) failures.push("NetworkOnly strategy is missing");
if (!source.includes("api") || !source.includes("auth")) failures.push("API/auth route guard is missing");

const precacheStart = source.indexOf("precacheAndRoute(");
const registerRouteStart = source.indexOf("registerRoute(");
const precacheSource = precacheStart >= 0 ? source.slice(precacheStart, registerRouteStart > precacheStart ? registerRouteStart : undefined) : "";
if (!precacheSource) failures.push("precache manifest was not found");
if (/\/api\/|\/auth\//.test(precacheSource)) failures.push("sensitive API/auth URL appears in the precache manifest");

if (failures.length) {
  for (const failure of failures) process.stderr.write(`Service-worker security check failed: ${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Service-worker security check passed: API/auth are NetworkOnly and absent from precache.\n");
}

