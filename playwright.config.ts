import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testIgnore: ["**/worker/**", "**/staging/**"],
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["iPhone 13"], browserName: "chromium" } },
    // Real Safari/WebKit, not Chromium-with-a-phone-viewport: WebKit enforces
    // flexbox's min-width:auto default much more strictly than Chromium, which
    // is exactly what let a real topbar horizontal-overflow bug ship
    // undetected (see tests/responsive.spec.ts).
    { name: "mobile-webkit", use: { ...devices["iPhone 15 Pro"] } },
  ],
  webServer: process.env.PLAYWRIGHT_EXISTING_SERVER ? undefined : {
      command: "npm run dev -- --host 127.0.0.1",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: true,
    },
});
