import { SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ORIGIN, jsonHeaders, migrate, resetDb, seedTwoTenants } from "../helpers";

/** Epic 28 gate: expensive operations are throttled beyond login. */
describe("security · rate limiting", () => {
  beforeAll(migrate);
  beforeEach(resetDb);

  it("throttles club export past the per-tenant limit", async () => {
    const { cookieA } = await seedTwoTenants();
    const created = await SELF.fetch(`${ORIGIN}/api/v1/clubs`, { method: "POST", headers: jsonHeaders(cookieA), body: JSON.stringify({ name: "Rate limit synthetic club" }) });
    const clubId = (await created.json<{ club: { id: string } }>()).club.id;

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 7; attempt += 1) {
      statuses.push((await SELF.fetch(`${ORIGIN}/api/v1/clubs/${clubId}/export`, { headers: { Cookie: cookieA } })).status);
    }
    expect(statuses.filter((status) => status === 200).length).toBeGreaterThanOrEqual(1);
    expect(statuses).toContain(429);
  });
});
