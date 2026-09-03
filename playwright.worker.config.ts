import { defineConfig, devices } from "@playwright/test";
import { PERSIST_DIR } from "./tests/worker/global-setup";

const PORT = 8788;

/**
 * End-to-end against the real Cloudflare Worker (wrangler dev --local) with a
 * real local D1: browser -> Worker -> Auth -> D1. Complements the Vite-only
 * `playwright.config.ts` suite and the Miniflare `cloudflare/test` suite.
 */
export default defineConfig({
  testDir: "./tests/worker",
  globalSetup: "./tests/worker/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx wrangler dev --local --persist-to ${PERSIST_DIR} --env development --ip 127.0.0.1 --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/login.css`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
