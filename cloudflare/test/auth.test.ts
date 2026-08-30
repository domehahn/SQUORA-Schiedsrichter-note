import { describe, expect, it } from "vitest";
import { createSession, verifyPassword, verifySession } from "../auth";

const TEST_HASH = "pbkdf2-sha256$100000$01010101010101010101010101010101$0a5cea6a96077c89c2e719a6adaac8df9216e53b118ff99290c775c8c7346382";
const EMAIL = "user@example.com";
const SECRET = "unit-test-session-secret-with-at-least-32-bytes";

describe("Worker-Authentifizierung", () => {
  it("prüft den PBKDF2-Passwort-Hash timing-sicher", async () => {
    await expect(verifyPassword("test-password", TEST_HASH)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", TEST_HASH)).resolves.toBe(false);
    await expect(verifyPassword("test-password", "invalid-hash")).resolves.toBe(false);
  });

  it("akzeptiert nur unveränderte, gültige Sessions für den richtigen Benutzer", async () => {
    const token = await createSession(EMAIL, SECRET, 1_000);
    await expect(verifySession(token, EMAIL, SECRET, 1_001)).resolves.toBe(true);
    await expect(verifySession(`${token}x`, EMAIL, SECRET, 1_001)).resolves.toBe(false);
    await expect(verifySession(token, "other@example.com", SECRET, 1_001)).resolves.toBe(false);
    await expect(verifySession(token, EMAIL, SECRET, 1_000 + 8 * 60 * 60)).resolves.toBe(false);
  });
});
