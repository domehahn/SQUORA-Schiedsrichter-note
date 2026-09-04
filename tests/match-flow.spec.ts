import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

test("erlaubt eigene Halbzeitlängen für F- und G-Jugend", async ({ page }) => {
  await openApp(page);
  const ageGroup = page.locator("select");
  const duration = page.locator('input[type="number"]');

  await ageGroup.selectOption("F");
  await expect(duration).toBeEnabled();
  await duration.fill("17");
  // F- und G-Jugend spielen laut FVR-Bestimmungen eine durchgehende Spielzeit
  // statt zweier Halbzeiten mit Seitenwechsel.
  await expect(page.getByText("17 Minuten, eine Halbzeit", { exact: true })).toBeVisible();

  await ageGroup.selectOption("G");
  await expect(duration).toBeEnabled();
  await duration.fill("12");
  await expect(page.getByText("12 Minuten, eine Halbzeit", { exact: true })).toBeVisible();

  await ageGroup.selectOption("D");
  await expect(duration).toBeDisabled();
  await expect(duration).toHaveValue("30");
});

test("führt ein Jugendspiel mit Tor, Wechsel, Karten und Spielende", async ({ page }) => {
  await page.clock.install();
  await openApp(page);
  await page.getByLabel("Name der Heimmannschaft").fill("SV Blau");
  await page.getByLabel("Name der Gastmannschaft").fill("FC Grün");
  await page.locator("select").selectOption("custom");
  await page.locator('input[type="number"]').fill("1");
  await page.getByRole("button", { name: "Spiel starten" }).click();

  await page.locator(".team-actions.home").getByRole("button", { name: "Tor Heim", exact: true }).click();
  await page.locator(".modal input").first().fill("2");
  await page.getByRole("button", { name: "Ereignis speichern" }).click();
  await expect(page.locator(".score")).toContainText("1");
  await expect(page.getByText("Tor SV Blau · Nr. 2", { exact: true })).toBeVisible();

  await page.locator(".team-actions.away").getByRole("button", { name: "Gelb Gast", exact: true }).click();
  await page.locator(".modal input").first().fill("7");
  await page.getByRole("button", { name: "Ereignis speichern" }).click();

  await page.clock.fastForward(65_000);
  await expect(page.getByText(/Nachspielzeit/).first()).toBeVisible();
  await page.getByRole("button", { name: "Halbzeit", exact: true }).click();
  await page.getByRole("button", { name: "2. Halbzeit starten" }).click();

  await page.locator(".team-actions.home").getByRole("button", { name: "Wechsel Heim", exact: true }).click();
  await page.locator(".modal input").nth(0).fill("8");
  await page.locator(".modal input").nth(1).fill("14");
  await page.getByRole("button", { name: "Ereignis speichern" }).click();
  await expect(page.getByText("Wechsel SV Blau · Nr. 8 raus, Nr. 14 rein", { exact: true })).toBeVisible();

  await page.clock.fastForward(65_000);
  await page.getByRole("button", { name: "Spielende", exact: true }).click();
  await expect(page.getByText("Beendet", { exact: true })).toBeVisible();
  await expect(page.locator(".event-table").getByText("Spielende", { exact: true })).toBeVisible();
  await expect(page.locator(".event-table")).toContainText("Tor SV Blau · Nr. 2");
});

test("spielt ein Funino-Spiel (F-Jugend) als eine durchgehende Spielzeit ohne Halbzeit", async ({ page }) => {
  await page.clock.install();
  await openApp(page);
  await page.locator("select").selectOption("F");
  await page.locator('input[type="number"]').fill("1");
  await page.getByRole("button", { name: "Spiel starten" }).click();

  // Es gibt keinen Halbzeitpfiff, nur ein direktes Spielende.
  await expect(page.getByRole("button", { name: "Halbzeit", exact: true })).not.toBeVisible();
  await expect(page.locator(".phase-pill")).toHaveText("Spielzeit");

  await page.locator(".team-actions.home").getByRole("button", { name: "Tor Heim", exact: true }).click();
  await page.locator(".modal input").first().fill("3");
  await page.getByRole("button", { name: "Ereignis speichern" }).click();
  await expect(page.locator(".score")).toContainText("1");

  await page.clock.fastForward(65_000);
  await page.getByRole("button", { name: "Spielende", exact: true }).click();
  await expect(page.getByText("Beendet", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "2. Halbzeit starten" })).not.toBeVisible();
  await expect(page.locator(".event-table").getByText("Spielende", { exact: true })).toBeVisible();
  await expect(page.locator(".event-table").getByText("Anpfiff", { exact: true })).toBeVisible();
});

test("bleibt auf schmalen Smartphones vollständig bedienbar", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  await page.setViewportSize({ width: 320, height: 568 });
  await openApp(page);

  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "CSV" }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "CSV" })).toBeInViewport();
  await expect(page.getByRole("button", { name: "Drucken", exact: true })).toBeInViewport();

  await page.getByRole("button", { name: "Spiel starten" }).click();
  const actionButtons = page.locator(".action-buttons button");
  for (let index = 0; index < await actionButtons.count(); index += 1) {
    expect((await actionButtons.nth(index).boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }

  await page.locator(".team-actions.home").getByRole("button", { name: "Tor Heim", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeInViewport();
  await expect(page.getByRole("button", { name: "Dialog schließen" })).toBeInViewport();
  await expect(page.getByRole("button", { name: "Ereignis speichern" })).toBeInViewport();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
