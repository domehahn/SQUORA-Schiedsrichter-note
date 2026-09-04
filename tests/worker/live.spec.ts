import { expect, test } from "@playwright/test";
import { E2E } from "./fixtures";
import { login, passGate } from "./helpers";

/** The public live-ticker link works end to end: browser -> real Worker -> D1 -> a second, unauthenticated browser tab. */
test("shares a live match and a spectator sees the score without logging in", async ({ page, browser }) => {
  await login(page, E2E.userA.email, E2E.userA.password);
  await passGate(page, "Worker E2E Live Club");
  await expect(page.locator("#setup-title")).toBeVisible();

  await page.getByLabel("Name der Heimmannschaft").fill("Live-Heim");
  await page.getByRole("button", { name: "Spiel starten" }).click();
  await page.locator(".team-actions.home").getByRole("button", { name: "Tor Heim", exact: true }).click();
  await page.locator(".modal input").first().fill("9");
  await page.getByRole("button", { name: "Ereignis speichern" }).click();

  // let the debounced autosave push the live draft to the server
  await page.waitForTimeout(2500);

  await page.getByRole("button", { name: "Liveticker" }).click();
  await page.getByRole("button", { name: "Liveticker freigeben" }).click();
  const link = page.locator(".live-share input[readonly]");
  await expect(link).toHaveValue(/\/live\//);
  const url = await link.inputValue();

  // a genuinely separate, cookie-free context — this must work with no session at all
  const spectatorContext = await browser.newContext();
  const spectator = await spectatorContext.newPage();
  try {
    await spectator.goto(url);
    await expect(spectator.locator("#home-name")).toHaveText("Live-Heim");
    await expect(spectator.locator("#score")).toHaveText("1 : 0");
    await expect(spectator.locator("#events")).toContainText("Tor");
    await expect(spectator.locator("#error")).toBeHidden();
  } finally {
    await spectatorContext.close();
  }

  // The referee account/club is reused by every spec in this suite; leave no
  // match running so the next test starts from a clean "Spiel starten" screen.
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Neues Spiel" }).click();
  await page.waitForTimeout(2500);
});
