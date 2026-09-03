import { expect, type Page } from "@playwright/test";

export const TEST_VEREIN = "Testverein";
export const TEST_PASSPHRASE = "test-passphrase-123";

/**
 * Gets past the Verein gate to the main app. Handles both first run (create form)
 * and re-locking after a reload (select + passphrase). No-op if the app is already shown.
 */
export async function passGate(page: Page, name = TEST_VEREIN, passphrase = TEST_PASSPHRASE): Promise<void> {
  await page.waitForSelector(".tenant-card, #setup-title");
  if (await page.locator("#setup-title").count()) return;

  if (await page.getByLabel("Vereinsname").count()) {
    await page.getByLabel("Vereinsname").fill(name);
    const password = page.locator(".tenant-card input[type='password']");
    await password.nth(0).fill(passphrase);
    await password.nth(1).fill(passphrase);
    await page.getByRole("button", { name: /Verein anlegen/ }).click();
  } else {
    await page.locator(".tenant-card select").selectOption({ label: name });
    await page.locator(".tenant-card input[type='password']").first().fill(passphrase);
    await page.getByRole("button", { name: "Öffnen", exact: true }).click();
  }
  await expect(page.locator("#setup-title")).toBeVisible();
}

/** Navigate to the app and unlock the gate. */
export async function openApp(page: Page): Promise<void> {
  await page.goto("/");
  await passGate(page);
}
