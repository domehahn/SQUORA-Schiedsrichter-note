import { expect, test, type Page } from "@playwright/test";
import { openApp, passGate } from "./helpers";

const MATCH_KEY_PREFIX = "squora-referee-note-match-v1:";

function matchKey(page: Page): Promise<string> {
  return page.evaluate((prefix) => {
    const key = Object.keys(localStorage).find((entry) => entry.startsWith(prefix));
    if (!key) throw new Error("no match key in localStorage");
    return key;
  }, MATCH_KEY_PREFIX);
}

test("erlaubt eigene Halbzeitlängen für F- und G-Jugend", async ({ page }) => {
  await openApp(page);
  const ageGroup = page.locator("select");
  const duration = page.locator('input[type="number"]');

  await ageGroup.selectOption("F");
  await expect(duration).toBeEnabled();
  await duration.fill("17");
  await expect(page.getByText("2 × 17 Minuten", { exact: true })).toBeVisible();

  await ageGroup.selectOption("G");
  await expect(duration).toBeEnabled();
  await duration.fill("12");
  await expect(page.getByText("2 × 12 Minuten", { exact: true })).toBeVisible();

  await ageGroup.selectOption("D");
  await expect(duration).toBeDisabled();
  await expect(duration).toHaveValue("30");
});

test("führt ein Jugendspiel mit Tor, Wechsel, Karten und Spielende", async ({ page }) => {
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

  const key = await matchKey(page);
  await page.evaluate((k) => {
    const state = JSON.parse(localStorage.getItem(k)!);
    state.firstHalfMs = 60_500;
    state.runningSince = null;
    localStorage.setItem(k, JSON.stringify(state));
  }, key);
  await page.reload();
  await passGate(page);
  await expect(page.getByText(/Nachspielzeit/).first()).toBeVisible();
  await page.getByRole("button", { name: "Halbzeit", exact: true }).click();
  await page.getByRole("button", { name: "2. Halbzeit starten" }).click();

  await page.locator(".team-actions.home").getByRole("button", { name: "Wechsel Heim", exact: true }).click();
  await page.locator(".modal input").nth(0).fill("8");
  await page.locator(".modal input").nth(1).fill("14");
  await page.getByRole("button", { name: "Ereignis speichern" }).click();
  await expect(page.getByText("Wechsel SV Blau · Nr. 8 raus, Nr. 14 rein", { exact: true })).toBeVisible();

  await page.evaluate((k) => {
    const state = JSON.parse(localStorage.getItem(k)!);
    state.secondHalfMs = 60_250;
    state.runningSince = null;
    localStorage.setItem(k, JSON.stringify(state));
  }, key);
  await page.reload();
  await passGate(page);
  await page.getByRole("button", { name: "Spielende", exact: true }).click();
  await expect(page.getByText("Beendet", { exact: true })).toBeVisible();
  await expect(page.locator(".event-table").getByText("Spielende", { exact: true })).toBeVisible();

  const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), key);
  expect(stored.events.some((event: { kind: string; player?: string }) => event.kind === "goal" && event.player === "2")).toBeTruthy();
  expect(stored.phase).toBe("finished");
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
