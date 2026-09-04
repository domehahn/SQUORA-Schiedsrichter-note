import { expect, test } from "@playwright/test";
import { E2E } from "./fixtures";
import { apiStatus, login, passGate } from "./helpers";

test.describe.configure({ mode: "serial" });

test("rejects wrong credentials, then signs in through the real Worker", async ({ page }) => {
  await page.goto("/");
  await page.locator("#email").fill(E2E.userA.email);
  await page.locator("#password").fill("wrong-password");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.locator(".error")).toBeVisible();

  await login(page, E2E.userA.email, E2E.userA.password);
  await passGate(page, "Worker E2E Club A");
  await expect(page.locator("#setup-title")).toBeVisible();

  const meResponse = await page.evaluate(async () => (await fetch("/api/v1/me")).json());
  expect((meResponse as { user: { email: string } }).user.email).toBe(E2E.userA.email);
});

test("keeps the session across a reload and clears it on logout", async ({ page }) => {
  await login(page, E2E.userA.email, E2E.userA.password);
  // club + team already exist from the previous test -> auto-selected, just open
  const open = page.getByRole("button", { name: "Öffnen", exact: true });
  const app = page.locator("#setup-title");
  await expect(open.or(app).first()).toBeVisible();
  if (await open.count()) await open.click();
  await expect(app).toBeVisible();

  await page.reload();
  expect(await apiStatus(page, "/api/v1/me")).toBe(200);

  await page.evaluate(() => fetch("/api/v1/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" } }));
  expect(await apiStatus(page, "/api/v1/me")).toBe(401);
});
