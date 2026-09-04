import { expect, type Page } from "@playwright/test";

export const TEST_VEREIN = "Testverein";
export const TEST_TEAM = "D1";

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
 * Gets past the membership-driven gate to the main app. First run: create the
 * club, then the first team, then open online (no passphrase). Reload: club and
 * team auto-select, so only "Öffnen" on the unlock step is left. No-op if the
 * app is already shown.
 */
export async function passGate(page: Page, name = TEST_VEREIN, team = TEST_TEAM): Promise<void> {
  await page.waitForSelector(".tenant-card, #setup-title");
  if (await page.locator("#setup-title").count()) return;

  const clubField = page.getByLabel("Vereinsname");
  const teamField = page.getByLabel("Mannschaft");
  const open = page.getByRole("button", { name: "Öffnen", exact: true });
  const app = page.locator("#setup-title");

  await expect(clubField.or(teamField).or(open).or(app).first()).toBeVisible();
  if (await clubField.count()) {
    await clubField.fill(name);
    await page.getByRole("button", { name: /Verein anlegen/ }).click();
  }

  await expect(teamField.or(open).or(app).first()).toBeVisible();
  if (await teamField.count()) {
    await teamField.fill(team);
    await page.getByRole("button", { name: /Anlegen & öffnen/ }).click();
  }

  // Unlock step: online-only, just open.
  await expect(open.or(app).first()).toBeVisible();
  if (await open.count()) await open.click();
  await expect(app).toBeVisible();
}

/** Navigate to the app and unlock the gate. */
export async function openApp(page: Page): Promise<void> {
  await installApiMock(page);
  await page.goto("/");
  await passGate(page);
}
