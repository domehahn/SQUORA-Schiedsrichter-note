import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

test("zeigt einen Hinweis, sobald der Service Worker eine neue Version meldet", async ({ page }) => {
  await openApp(page);
  await expect(page.getByText("Neue Version verfügbar")).not.toBeVisible();

  // Simulates what main.tsx's registerSW(onNeedRefresh) fires in production —
  // dispatched directly rather than triggering a real SW update cycle, which
  // isn't active in the dev-server test environment.
  await page.evaluate(() => window.dispatchEvent(new Event("squora:sw-update-available")));

  await expect(page.getByText("Neue Version verfügbar")).toBeVisible();
  await expect(page.getByRole("button", { name: "Aktualisieren" })).toBeVisible();
});
