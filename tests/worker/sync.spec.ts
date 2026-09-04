import { expect, test } from "@playwright/test";
import { E2E } from "./fixtures";
import { login, passGate } from "./helpers";

/** A recorded match survives a reload — the delta upload + getState round-trip against real D1. */
test("records a match and it survives a reload (delta sync against the real Worker)", async ({ page }) => {
  await login(page, E2E.userA.email, E2E.userA.password);
  await passGate(page, "Worker E2E Sync Club");
  await expect(page.locator("#setup-title")).toBeVisible();

  await page.getByLabel("Name der Heimmannschaft").fill("Sync-Heim");
  await page.getByRole("button", { name: "Spiel starten" }).click();
  await page.locator(".team-actions.home").getByRole("button", { name: "Tor Heim", exact: true }).click();
  await page.locator(".modal input").first().fill("9");
  await page.getByRole("button", { name: "Ereignis speichern" }).click();
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.locator(".archive-table")).toContainText("Sync-Heim");

  // give the debounced sync a moment, then reload and re-open the team
  await page.waitForTimeout(2500);
  await page.reload();
  const open = page.getByRole("button", { name: "Öffnen", exact: true });
  const app = page.locator("#setup-title");
  await expect(open.or(app).first()).toBeVisible();
  if (await open.count()) await open.click();
  await expect(app).toBeVisible();
  await expect(page.locator(".archive-table")).toContainText("Sync-Heim");
});
