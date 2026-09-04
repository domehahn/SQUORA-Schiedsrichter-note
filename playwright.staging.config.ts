import { defineConfig, devices } from "@playwright/test";

/**
 * Remote smoke / E2E against the deployed Cloudflare **staging** Worker
 * (`schiri-staging.squora.de`) — the only way to exercise the real workerd
 * runtime (WebCrypto, node:crypto, D1 transactions, RateLimit bindings) that
 * `wrangler dev --local` and Miniflare cannot fully reproduce.
 *
 * Required environment:
 *   STAGING_URL             e.g. https://schiri-staging.squora.de
 *   STAGING_TEST_EMAIL      a synthetic staging account (never a real person)
 *   STAGING_TEST_PASSWORD
 *
 * Run: `npm run test:e2e:staging`. In CI it is a gated job (see ci.yml).
 */
const baseURL = process.env.STAGING_URL ?? "";
if (!baseURL) {
  throw new Error("STAGING_URL is required for the staging E2E suite (e.g. https://schiri-staging.squora.de).");
}

export default defineConfig({
  testDir: "./tests/staging",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 1,
  timeout: 30_000,
  use: {
    baseURL,
    trace: "retain-on-failure",
    extraHTTPHeaders: { "X-SQUORA-E2E": "staging-smoke" },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
