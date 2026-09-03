const encoder = new TextEncoder();
const decoder = new TextDecoder();
const PBKDF2_ITERATIONS = 210_000;

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/** Derives a non-extractable AES-GCM key from a passphrase + per-tenant salt. */
export async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptString(key: CryptoKey, plaintext: string): Promise<{ iv: string; ciphertext: string }> {
  const iv = randomBytes(12);
  const buffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, encoder.encode(plaintext));
  return { iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(buffer)) };
}

/** Returns the decrypted string, or null if the key/data do not match (wrong passphrase, tampering). */
export async function decryptString(key: CryptoKey, iv: string, ciphertext: string): Promise<string | null> {
  try {
    const buffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(iv) as BufferSource },
      key,
      fromBase64(ciphertext) as BufferSource,
    );
    return decoder.decode(buffer);
  } catch {
    return null;
  }
}
