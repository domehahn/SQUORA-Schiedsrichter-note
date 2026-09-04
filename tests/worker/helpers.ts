import { expect, type Page } from "@playwright/test";

export async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.waitForSelector(".tenant-card, #setup-title");
}

/** First-run gate: create the club, then the first team, then open online. */
export async function passGate(page: Page, club: string, team = "D1"): Promise<void> {
  const clubField = page.getByLabel("Vereinsname");
  const teamField = page.getByLabel("Mannschaft");
  const open = page.getByRole("button", { name: "Öffnen", exact: true });
  const app = page.locator("#setup-title");
  if (await app.count()) return;

  await expect(clubField.or(teamField).or(open).or(app).first()).toBeVisible();
  if (await clubField.count()) {
    await clubField.fill(club);
    await page.getByRole("button", { name: /Verein anlegen/ }).click();
  }

  await expect(teamField.or(open).or(app).first()).toBeVisible();
  if (await teamField.count()) {
    await teamField.fill(team);
    await page.getByRole("button", { name: /Anlegen & öffnen/ }).click();
  }

  await expect(open.or(app).first()).toBeVisible();
  if (await open.count()) await open.click();
  await expect(app).toBeVisible();
}

/** Runs fetch() inside the page so the real session cookie is attached. */
export async function apiStatus(page: Page, path: string): Promise<number> {
  return page.evaluate(async (p) => (await fetch(p, { headers: { Accept: "application/json" } })).status, path);
}
