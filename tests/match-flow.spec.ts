import { expect, test } from "@playwright/test";

const storageKey = "squora-referee-note-match-v1";

test("führt ein Jugendspiel mit Tor, Wechsel, Karten und Spielende", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Name der Heimmannschaft").fill("SV Blau");
  await page.getByLabel("Name der Gastmannschaft").fill("FC Grün");
  await page.locator("select").selectOption("custom");
  await page.locator('input[type="number"]').fill("1");
  await page.getByRole("button", { name: "Spiel starten" }).click();

  await page.locator(".team-actions.home").getByRole("button", { name: /Tor/ }).click();
  await page.locator(".modal input").fill("2");
  await page.getByRole("button", { name: "Ereignis speichern" }).click();
  await expect(page.locator(".score")).toContainText("1");
  await expect(page.getByText("Tor SV Blau · Nr. 2", { exact: true })).toBeVisible();

  await page.locator(".team-actions.away").getByRole("button", { name: /Gelb/ }).click();
  await page.locator(".modal input").fill("7");
  await page.getByRole("button", { name: "Ereignis speichern" }).click();

  await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key)!);
    state.firstHalfMs = 60_500;
    state.runningSince = null;
    localStorage.setItem(key, JSON.stringify(state));
  }, storageKey);
  await page.reload();
  await expect(page.getByText(/Nachspielzeit/).first()).toBeVisible();
  await page.getByRole("button", { name: "Halbzeit", exact: true }).click();
  await page.getByRole("button", { name: "2. Halbzeit starten" }).click();

  await page.locator(".team-actions.home").getByRole("button", { name: /Wechsel/ }).click();
  await page.locator(".modal input").nth(0).fill("8");
  await page.locator(".modal input").nth(1).fill("14");
  await page.getByRole("button", { name: "Ereignis speichern" }).click();
  await expect(page.getByText("Wechsel SV Blau · Nr. 8 raus, Nr. 14 rein", { exact: true })).toBeVisible();

  await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key)!);
    state.secondHalfMs = 60_250;
    state.runningSince = null;
    localStorage.setItem(key, JSON.stringify(state));
  }, storageKey);
  await page.reload();
  await page.getByRole("button", { name: "Spielende", exact: true }).click();
  await expect(page.getByText("Beendet", { exact: true })).toBeVisible();
  await expect(page.getByText("Spielende", { exact: true }).last()).toBeVisible();

  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), storageKey);
  expect(stored.events.some((event: { kind: string; player?: string }) => event.kind === "goal" && event.player === "2")).toBeTruthy();
  expect(stored.phase).toBe("finished");
});

test("bleibt auf schmalen Smartphones vollständig bedienbar", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");

  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "CSV" }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "CSV" })).toBeInViewport();
  await expect(page.getByRole("button", { name: "Drucken" })).toBeInViewport();

  await page.getByRole("button", { name: "Spiel starten" }).click();
  const actionButtons = page.locator(".action-buttons button");
  for (let index = 0; index < await actionButtons.count(); index += 1) {
    expect((await actionButtons.nth(index).boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }

  await page.locator(".team-actions.home").getByRole("button", { name: /Tor/ }).click();
  await expect(page.getByRole("dialog")).toBeInViewport();
  await expect(page.getByRole("button", { name: "Dialog schließen" })).toBeInViewport();
  await expect(page.getByRole("button", { name: "Ereignis speichern" })).toBeInViewport();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
