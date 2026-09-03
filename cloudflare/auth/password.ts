const encoder = new TextEncoder();
export const PASSWORD_ITERATIONS = 600_000;
const MIN_ACCEPTED_ITERATIONS = 100_000;
const MAX_ACCEPTED_ITERATIONS = 1_000_000;

function hexToBytes(value: string): Uint8Array | null {
  if (value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  if (!password || password.length > 1024) return false;
  const [algorithm, iterationsText, saltText, hashText, extra] = encodedHash.split("$");
  const iterations = Number(iterationsText);
  if (extra !== undefined || algorithm !== "pbkdf2-sha256" || !Number.isInteger(iterations) || iterations < MIN_ACCEPTED_ITERATIONS || iterations > MAX_ACCEPTED_ITERATIONS) return false;
  const salt = hexToBytes(saltText ?? "");
  const expected = hexToBytes(hashText ?? "");
  if (!salt || salt.length < 16 || !expected || expected.length !== 32) return false;
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, material, 256);
  return crypto.subtle.timingSafeEqual(new Uint8Array(derived), expected);
}

