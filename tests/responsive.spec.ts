import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

/**
 * Regression guard for a real bug: the topbar's brand + action buttons didn't
 * shrink enough to fit an iPhone 15 Pro's 393px viewport under real
 * Safari/WebKit rendering — it overflowed horizontally, cutting off the sync
 * status and other topbar content. Chromium's mobile *viewport emulation*
 * (used by the "mobile-chromium" project) did not reproduce this: WebKit
 * enforces flexbox's min-width:auto default more strictly, so a real
 * WebKit-engine run (the "mobile-webkit" project) is what actually catches
 * it — this test runs on every project, but only mobile-webkit is meaningful
 * for the specific bug that motivated it.
 */
async function assertNoHorizontalOverflow(page: import("@playwright/test").Page, context: string): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${context}: page is ${overflow}px wider than the viewport`).toBeLessThanOrEqual(1);
}

test("kein horizontales Überlaufen auf schmalen Bildschirmen (Topbar, Spiel, Aufstellung)", async ({ page }) => {
  await openApp(page);
  await assertNoHorizontalOverflow(page, "Spielvorbereitung");

  await page.getByRole("button", { name: "Spiel starten" }).click();
  await assertNoHorizontalOverflow(page, "laufendes Spiel");

  await page.getByRole("button", { name: "Mannschaftsaufstellungen" }).click();
  await assertNoHorizontalOverflow(page, "Mannschaftsaufstellungen (Skizze + Kader-Tabelle)");
});
