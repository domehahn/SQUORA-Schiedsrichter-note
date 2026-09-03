import { SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CLUB_A, ORIGIN, migrate, resetDb, seedTwoTenants } from "../helpers";

/** Epic 25 gate: state-changing requests require a same-origin proof. */
describe("security · CSRF", () => {
  beforeAll(migrate);
  beforeEach(resetDb);

  it("rejects a mutation with a foreign Origin", async () => {
    const { cookieA } = await seedTwoTenants();
    const response = await SELF.fetch(`${ORIGIN}/api/v1/clubs`, {
      method: "POST",
      headers: { Cookie: cookieA, Origin: "https://evil.example", "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x" }),
    });
    expect(response.status).toBe(403);
    expect((await response.json<{ error: { code: string } }>()).error.code).toBe("CSRF_REJECTED");
  });

  it("rejects a mutation carrying neither Origin nor a same-origin Sec-Fetch-Site", async () => {
    const { cookieA } = await seedTwoTenants();
    const response = await SELF.fetch(`${ORIGIN}/api/v1/clubs/${CLUB_A}`, {
      method: "DELETE",
      headers: { Cookie: cookieA, "Content-Type": "application/json", "Sec-Fetch-Site": "cross-site" },
      body: JSON.stringify({ confirm: "Club A Test" }),
    });
    expect(response.status).toBe(403);
  });

  it("accepts a same-origin mutation", async () => {
    const { cookieA } = await seedTwoTenants();
    const response = await SELF.fetch(`${ORIGIN}/api/v1/clubs`, {
      method: "POST",
      headers: { Cookie: cookieA, Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Fresh synthetic club" }),
    });
    expect(response.status).toBe(201);
  });
});
