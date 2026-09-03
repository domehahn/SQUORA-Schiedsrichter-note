import { expect, type Page } from "@playwright/test";

export const TEST_VEREIN = "Testverein";
export const TEST_TEAM = "D1";
export const TEST_PASSPHRASE = "test-passphrase-123";

async function installApiMock(page: Page): Promise<void> {
  const clubs: Array<Record<string, unknown>> = [];
  const teamsByClub = new Map<string, Array<Record<string, unknown>>>();
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
      const club = { id: crypto.randomUUID(), name: input.name, slug: "synthetic-club", cacheSalt: "AAAAAAAAAAAAAAAAAAAAAA==", role: "club_owner", permissions: ["club.read", "matches.update", "teams.manage"] };
      clubs.push(club);
      teamsByClub.set(club.id as string, []);
      return respond({ club }, 201);
    }
    const teamsMatch = path.match(/\/api\/v1\/clubs\/([^/]+)\/teams$/);
    if (teamsMatch) {
      const clubId = teamsMatch[1];
      const list = teamsByClub.get(clubId) ?? [];
      if (request.method() === "GET") return respond({ teams: list });
      const input = request.postDataJSON() as { name: string; ageGroup?: string };
      const team = { id: crypto.randomUUID(), name: input.name, ageGroup: input.ageGroup ?? null };
      list.push(team);
      teamsByClub.set(clubId, list);
      return respond({ team }, 201);
    }
    const stateMatch = path.match(/\/api\/v1\/clubs\/([^/]+)\/teams\/([^/]+)\/state$/);
    if (stateMatch) {
      const scope = `${stateMatch[1]}:${stateMatch[2]}`;
      if (request.method() === "GET") return respond(states.get(scope) ?? { version: 0, archive: [], deletedIds: [], tournaments: [], teams: [], current: null });
      const input = request.postDataJSON() as Record<string, unknown>;
      const currentVersion = Number(states.get(scope)?.version ?? 0);
      if (Number(input.version) !== currentVersion) return respond({ error: { code: "VERSION_CONFLICT" } }, 409);
      states.set(scope, { ...input, version: currentVersion + 1 });
      return respond({ ok: true, version: currentVersion + 1 });
    }
    return respond({ error: { code: "NOT_FOUND" } }, 404);
  });
}

/**
 * Gets past the Verein + Mannschaft gate to the main app. Handles first run
 * (create club, then create team) and re-locking after a reload (select club +
 * passphrase, then select team). No-op if the app is already shown.
 */
export async function passGate(page: Page, name = TEST_VEREIN, passphrase = TEST_PASSPHRASE, team = TEST_TEAM): Promise<void> {
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
    await page.getByRole("button", { name: "Weiter", exact: true }).click();
  }

  await page.waitForSelector(".tenant-card :text('Mannschaft')");
  const createTeamBtn = page.getByRole("button", { name: /Anlegen & öffnen/ });
  if (await createTeamBtn.count()) {
    await page.getByLabel("Mannschaft").fill(team);
    await createTeamBtn.click();
  } else {
    await page.locator(".tenant-card select").selectOption({ index: 1 });
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
