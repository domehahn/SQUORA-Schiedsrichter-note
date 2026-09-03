import { expect, type Page } from "@playwright/test";

export const TEST_VEREIN = "Testverein";
export const TEST_PASSPHRASE = "test-passphrase-123";

async function installApiMock(page: Page): Promise<void> {
  const clubs: Array<Record<string, unknown>> = [];
  const states = new Map<string, Record<string, unknown>>();
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const respond = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path.endsWith("/api/v1/me")) return respond({ user: { id: "test-user", email: "user@example.invalid", displayName: "Test User" } });
    if (path.endsWith("/api/archive")) return respond({ archive: [], deletedIds: [], tournaments: [], teams: [], current: null });
    if (path.endsWith("/api/v1/clubs") && request.method() === "GET") return respond({ clubs });
    if (path.endsWith("/api/v1/clubs") && request.method() === "POST") {
      const input = request.postDataJSON() as { name: string };
      const club = { id: crypto.randomUUID(), name: input.name, slug: "synthetic-club", cacheSalt: "AAAAAAAAAAAAAAAAAAAAAA==", role: "club_owner", permissions: ["club.read", "matches.update"] };
      clubs.push(club);
      return respond({ club }, 201);
    }
    const stateMatch = path.match(/\/api\/v1\/clubs\/([^/]+)\/state$/);
    if (stateMatch) {
      const clubId = stateMatch[1];
      if (request.method() === "GET") return respond(states.get(clubId) ?? { version: 0, archive: [], deletedIds: [], tournaments: [], teams: [], current: null });
      const input = request.postDataJSON() as Record<string, unknown>;
      const currentVersion = Number(states.get(clubId)?.version ?? 0);
      if (Number(input.version) !== currentVersion) return respond({ error: { code: "VERSION_CONFLICT" } }, 409);
      const state = { ...input, version: currentVersion + 1 };
      states.set(clubId, state);
      return respond({ ok: true, version: currentVersion + 1 });
    }
    return respond({ error: { code: "NOT_FOUND" } }, 404);
  });
}

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
  await installApiMock(page);
  await page.goto("/");
  await passGate(page);
}
