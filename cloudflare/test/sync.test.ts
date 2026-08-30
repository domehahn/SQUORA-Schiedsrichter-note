import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createSession } from "../auth";

const EMAIL = "dominik87hahn@gmail.com";
const SECRET = "unit-test-session-secret-with-at-least-32-bytes";
const ORIGIN = "https://example.com";
const URL = `${ORIGIN}/schiedsrichter-note/api/archive`;

async function authCookie(): Promise<string> {
  return `squora_referee_session=${await createSession(EMAIL, SECRET)}`;
}

const samplePayload = {
  archive: [{
    savedAt: "2026-08-30T12:00:00.000Z",
    state: { version: 2, id: "m1", homeTeam: "A", awayTeam: "B", events: [] },
  }],
  deletedIds: ["gone"],
  tournaments: [{ id: "t1", name: "Cup", date: "2026-08-30", groups: ["A"], fixtures: [], updatedAt: "2026-08-30T12:00:00.000Z" }],
  current: null,
};

describe("Sync-Endpunkt /api/archive", () => {
  beforeEach(async () => {
    const cookie = await authCookie();
    await SELF.fetch(URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: cookie },
      body: JSON.stringify({ archive: [], deletedIds: [], tournaments: [], current: null }),
    });
  });

  it("verweigert den Zugriff ohne gültige Session", async () => {
    const response = await SELF.fetch(URL);
    expect(response.status).toBe(401);
  });

  it("liefert für Angemeldete eine leere Grundstruktur", async () => {
    const response = await SELF.fetch(URL, { headers: { Cookie: await authCookie() } });
    expect(response.status).toBe(200);
    const data = await response.json<{ archive: unknown[]; tournaments: unknown[] }>();
    expect(data.archive).toEqual([]);
    expect(data.tournaments).toEqual([]);
  });

  it("speichert Archiv, Turniere und Tombstones und gibt sie wieder aus", async () => {
    const cookie = await authCookie();
    const put = await SELF.fetch(URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: cookie },
      body: JSON.stringify(samplePayload),
    });
    expect(put.status).toBe(200);

    const get = await SELF.fetch(URL, { headers: { Cookie: cookie } });
    const data = await get.json<typeof samplePayload & { updatedAt: string }>();
    expect(data.archive).toHaveLength(1);
    expect(data.deletedIds).toEqual(["gone"]);
    expect(data.tournaments[0].id).toBe("t1");
    expect(typeof data.updatedAt).toBe("string");
  });

  it("lehnt fremde Origins (CSRF) und kaputte Payloads ab", async () => {
    const cookie = await authCookie();
    const csrf = await SELF.fetch(URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: "https://evil.example", Cookie: cookie },
      body: JSON.stringify(samplePayload),
    });
    expect(csrf.status).toBe(403);

    const broken = await SELF.fetch(URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: cookie },
      body: JSON.stringify({ nothing: true }),
    });
    expect(broken.status).toBe(422);
  });
});
