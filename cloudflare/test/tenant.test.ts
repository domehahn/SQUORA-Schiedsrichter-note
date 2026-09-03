import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createSession } from "../auth";

const EMAIL = "dominik87hahn@gmail.com";
const SECRET = "unit-test-session-secret-with-at-least-32-bytes";
const ORIGIN = "https://example.com";

async function cookie(sub = EMAIL): Promise<string> {
  return `squora_referee_session=${await createSession(sub, SECRET)}`;
}

const tenantMeta = {
  id: "abc123",
  name: "SV Blau",
  salt: "c2FsdHNhbHRzYWx0c2FsdA==",
  verifierIv: "aXZpdml2aXZpdml2",
  verifier: "Y2lwaGVydGV4dA==",
  createdAt: "2026-09-03T10:00:00.000Z",
};

describe("Tenant-Endpunkte", () => {
  it("liefert einen leeren Vereins-Index für Angemeldete", async () => {
    const response = await SELF.fetch(`${ORIGIN}/schiedsrichter-note/api/tenants`, { headers: { Cookie: await cookie() } });
    expect(response.status).toBe(200);
    const data = await response.json<{ tenants: unknown[] }>();
    expect(data.tenants).toEqual([]);
  });

  it("speichert und liest den Vereins-Index", async () => {
    const c = await cookie();
    const put = await SELF.fetch(`${ORIGIN}/schiedsrichter-note/api/tenants`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: c },
      body: JSON.stringify({ tenants: [tenantMeta, { id: "!!bad!!", name: "x" }] }),
    });
    expect(put.status).toBe(200);
    const get = await SELF.fetch(`${ORIGIN}/schiedsrichter-note/api/tenants`, { headers: { Cookie: c } });
    const data = await get.json<{ tenants: { id: string }[] }>();
    expect(data.tenants).toHaveLength(1);
    expect(data.tenants[0].id).toBe("abc123");
  });

  it("speichert verschlüsselte Vereinsdaten unter einer Tenant-ID und trennt sie", async () => {
    const c = await cookie();
    const url = `${ORIGIN}/schiedsrichter-note/api/tenant/abc123`;
    expect((await SELF.fetch(`${ORIGIN}/schiedsrichter-note/api/tenant/missing`, { headers: { Cookie: c } })).status).toBe(404);

    const put = await SELF.fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: c },
      body: JSON.stringify({ iv: "aXZpdml2aXZpdml2", ciphertext: "ZW5jcnlwdGVk" }),
    });
    expect(put.status).toBe(200);

    const get = await SELF.fetch(url, { headers: { Cookie: c } });
    const data = await get.json<{ iv: string; ciphertext: string }>();
    expect(data).toMatchObject({ iv: "aXZpdml2aXZpdml2", ciphertext: "ZW5jcnlwdGVk" });

    const bad = await SELF.fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: c },
      body: JSON.stringify({ nope: true }),
    });
    expect(bad.status).toBe(422);
  });

  it("weist ungültige Tenant-IDs und fremde Origins ab", async () => {
    const c = await cookie();
    expect((await SELF.fetch(`${ORIGIN}/schiedsrichter-note/api/tenant/has%20space`, { headers: { Cookie: c } })).status).toBe(400);
    const csrf = await SELF.fetch(`${ORIGIN}/schiedsrichter-note/api/tenants`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: "https://evil.example", Cookie: c },
      body: JSON.stringify({ tenants: [] }),
    });
    expect(csrf.status).toBe(403);
  });

  it("lehnt eine Session ab, deren Konto nicht (mehr) existiert", async () => {
    const response = await SELF.fetch(`${ORIGIN}/schiedsrichter-note/api/tenants`, { headers: { Cookie: await cookie("stranger@example.com") } });
    expect(response.status).toBe(401);
  });
});
