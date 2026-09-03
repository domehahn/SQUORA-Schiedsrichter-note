import { expect, type Page } from "@playwright/test";

export async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.waitForSelector(".tenant-card, #setup-title");
}

/** First-run gate: create the club, then the first team. */
export async function passGate(page: Page, club: string, team = "D1", passphrase = "worker-e2e-passphrase"): Promise<void> {
  if (await page.locator("#setup-title").count()) return;
  await page.getByLabel("Vereinsname").fill(club);
  const pw = page.locator(".tenant-card input[type='password']");
  await pw.nth(0).fill(passphrase);
  await pw.nth(1).fill(passphrase);
  await page.getByRole("button", { name: /Verein anlegen/ }).click();

  await page.waitForSelector(".tenant-card :text('Mannschaft')");
  await page.getByLabel("Mannschaft").fill(team);
  await page.getByRole("button", { name: /Anlegen & öffnen/ }).click();
  await expect(page.locator("#setup-title")).toBeVisible();
}

/** Runs fetch() inside the page so the real session cookie is attached. */
export async function apiStatus(page: Page, path: string): Promise<number> {
  return page.evaluate(async (p) => (await fetch(p, { headers: { Accept: "application/json" } })).status, path);
}
