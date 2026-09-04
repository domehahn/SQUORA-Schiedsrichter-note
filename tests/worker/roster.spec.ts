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
