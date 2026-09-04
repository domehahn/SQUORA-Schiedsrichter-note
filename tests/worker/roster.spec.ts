import { expect, test } from "@playwright/test";
import { E2E } from "./fixtures";
import { login, passGate } from "./helpers";

/** The relational "Mein Kader" panel persists a player to the server (players table). */
test("adds a team player and it survives a reload", async ({ page }) => {
  await login(page, E2E.userA.email, E2E.userA.password);
  await passGate(page, "Worker E2E Roster Club");
  await expect(page.locator("#setup-title")).toBeVisible();

  await page.getByRole("button", { name: /Mein Kader/ }).click();
  await page.getByRole("button", { name: "Spieler hinzufügen" }).click();
  const nameCell = page.locator(".roster-table .roster-name").last();
  await expect(nameCell).toHaveValue("Neuer Spieler");
  await nameCell.fill("Server Testspieler");
  await nameCell.blur();
  // give the PATCH a beat
  await page.waitForTimeout(500);

  await page.reload();
  const open = page.getByRole("button", { name: "Öffnen", exact: true });
  const app = page.locator("#setup-title");
  await expect(open.or(app).first()).toBeVisible();
  if (await open.count()) await open.click();
  await expect(app).toBeVisible();

  await page.getByRole("button", { name: /Mein Kader/ }).click();
  await expect(page.locator(".roster-table .roster-name")).toHaveValue("Server Testspieler");
});
