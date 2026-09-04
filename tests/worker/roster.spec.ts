import { expect, test } from "@playwright/test";
import { E2E } from "./fixtures";
import { login, passGate } from "./helpers";

/** The relational "Mein Kader" panel persists a player to the server (players table). */
test("edits the roster and it survives a reload", async ({ page }) => {
  await login(page, E2E.userA.email, E2E.userA.password);
  await passGate(page, "Worker E2E Roster Club");
  await expect(page.locator("#setup-title")).toBeVisible();

  await page.getByRole("button", { name: /Mein Kader/ }).click();
  const panel = page.locator(".tournament-panel").filter({ has: page.locator(".roster-table") });
  await panel.getByRole("button", { name: "Bearbeiten" }).click();
  await panel.getByRole("button", { name: "Spieler hinzufügen" }).click();
  const lastName = panel.locator(".roster-table tbody tr").last().locator(".roster-name").nth(1);
  await lastName.fill("Server Testspieler");
  await panel.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Kader gespeichert.")).toBeVisible();

  await page.reload();
  const open = page.getByRole("button", { name: "Öffnen", exact: true });
  const app = page.locator("#setup-title");
  await expect(open.or(app).first()).toBeVisible();
  if (await open.count()) await open.click();
  await expect(app).toBeVisible();

  await page.getByRole("button", { name: /Mein Kader/ }).click();
  await expect(page.locator(".roster-table tbody")).toContainText("Server Testspieler");
});

/** Kader -> Heim-Aufstellung -> Pitch assignment shows a position chip on the (read-only) roster row. */
test("shows a position chip on the home lineup row once assigned on the pitch", async ({ page }) => {
  await login(page, E2E.userA.email, E2E.userA.password);
  await passGate(page, "Worker E2E Position Chip Club");
  await expect(page.locator("#setup-title")).toBeVisible();

  await page.getByRole("button", { name: /Mein Kader/ }).click();
  const kader = page.locator(".tournament-panel").filter({ has: page.locator(".roster-table") });
  await kader.getByRole("button", { name: "Bearbeiten" }).click();
  await kader.getByRole("button", { name: "Spieler hinzufügen" }).click();
  await kader.locator(".roster-table tbody tr").last().locator(".roster-name").nth(1).fill("Chip Testspieler");
  await kader.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Kader gespeichert.")).toBeVisible();
  await kader.getByRole("button", { name: "→ Heim-Aufstellung" }).click();

  await page.getByRole("button", { name: "Mannschaftsaufstellungen" }).click();
  const home = page.locator(".roster-editor > div").first();
  await home.locator(".roster-table tbody tr", { hasText: "Chip Testspieler" }).locator(".status-seg.seg-start").click();

  const pitch = home.locator(".pitch-view");
  await pitch.locator(".pitch-slot").first().click();
  await pitch.locator(".pitch-assign select").selectOption({ label: "Chip Testspieler" });

  const chippedRow = home.locator(".roster-table tbody tr", { hasText: "Chip Testspieler" });
  await expect(chippedRow.locator(".position-chip")).toBeVisible();
  await expect(chippedRow.locator(".position-chip small")).toHaveText("Testspieler");
});
