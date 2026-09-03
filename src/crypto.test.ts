import { describe, expect, it } from "vitest";
import { decryptString, deriveKey, encryptString, fromBase64, randomBytes, toBase64 } from "./crypto";

describe("crypto helpers", () => {
  it("base64 round-trips arbitrary bytes", () => {
    const bytes = randomBytes(40);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });

  it("encrypts and decrypts with the same passphrase + salt", async () => {
    const salt = randomBytes(16);
    const key = await deriveKey("hunter2-hunter2", salt);
    const { iv, ciphertext } = await encryptString(key, '{"archive":[1,2,3]}');
    expect(await decryptString(key, iv, ciphertext)).toBe('{"archive":[1,2,3]}');
  });

  it("fails to decrypt with a different passphrase", async () => {
    const salt = randomBytes(16);
    const right = await deriveKey("correct horse", salt);
    const wrong = await deriveKey("wrong horse", salt);
    const { iv, ciphertext } = await encryptString(right, "geheim");
    expect(await decryptString(wrong, iv, ciphertext)).toBeNull();
  });

  it("fails to decrypt tampered ciphertext", async () => {
    const key = await deriveKey("pw", randomBytes(16));
    const { iv, ciphertext } = await encryptString(key, "geheim");
    const flipped = toBase64(fromBase64(ciphertext).map((byte, index) => (index === 0 ? byte ^ 1 : byte)));
    expect(await decryptString(key, iv, flipped)).toBeNull();
  });
});
