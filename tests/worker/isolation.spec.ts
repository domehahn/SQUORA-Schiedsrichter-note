import { expect, test } from "@playwright/test";
import { E2E } from "./fixtures";
import { apiStatus, login, passGate } from "./helpers";

test("a signed-in referee cannot reach another club through the real API", async ({ page }) => {
  await login(page, E2E.userA.email, E2E.userA.password);
  await passGate(page, "Worker E2E Isolation Club");
  await expect(page.locator("#setup-title")).toBeVisible();

  // Foreign club B (seeded for user B) is invisible to A: 404, never 403.
  expect(await apiStatus(page, `/api/v1/clubs/${E2E.clubB}`)).toBe(404);
  expect(await apiStatus(page, `/api/v1/clubs/${E2E.clubB}/export`)).toBe(404);
  expect(await apiStatus(page, `/api/v1/clubs/${E2E.clubB}/teams/${E2E.teamB}/state`)).toBe(404);
  expect(await apiStatus(page, `/api/v1/clubs/${E2E.clubB}/teams`)).toBe(404);

  // Unknown identifiers are indistinguishable from foreign ones.
  expect(await apiStatus(page, "/api/v1/clubs/cccccccc-cccc-4ccc-8ccc-cccccccccccc")).toBe(404);
  expect(await apiStatus(page, "/api/v1/clubs/not-a-uuid")).toBe(404);

  // A's own club list never leaks club B.
  const clubs = await page.evaluate(async () => (await (await fetch("/api/v1/clubs")).json()).clubs as { id: string }[]);
  expect(clubs.some((club) => club.id === E2E.clubB)).toBe(false);
});
