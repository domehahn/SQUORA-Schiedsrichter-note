const encoder = new TextEncoder();

// The Workers runtime caps a single WebCrypto PBKDF2 call at 100 000 iterations,
// so a higher work factor is reached by chaining rounds: each round runs
// PBKDF2-SHA256(previous output, salt, 100 000). ROUNDS = 6 ≈ 600 000 iterations.
const ROUND_ITERATIONS = 100_000;
const ROUNDS = 6;

export const PASSWORD_PARAMS = `${ROUND_ITERATIONS}*${ROUNDS}`;

function hexToBytes(value: string): Uint8Array | null {
  if (value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

async function deriveChained(password: Uint8Array, salt: Uint8Array, roundIterations: number, rounds: number): Promise<Uint8Array> {
  let material = password;
  let out = new Uint8Array(32);
  for (let round = 0; round < rounds; round += 1) {
    const key = await crypto.subtle.importKey("raw", material as BufferSource, "PBKDF2", false, ["deriveBits"]);
    out = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: roundIterations }, key, 256));
    material = out;
  }
  return out;
}

/**
 * Verifies a `pbkdf2-sha256$<roundIter>*<rounds>$<saltHex>$<hashHex>` string.
 * Legacy single-round hashes (`…$100000$…`, no `*`) are still accepted.
 */
export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  if (!password || password.length > 1024) return false;
  const [algorithm, paramsText, saltText, hashText, extra] = encodedHash.split("$");
  if (extra !== undefined || algorithm !== "pbkdf2-sha256") return false;
  const [iterText, roundText] = (paramsText ?? "").split("*");
  const roundIterations = Number(iterText);
  const rounds = roundText === undefined ? 1 : Number(roundText);
  if (!Number.isInteger(roundIterations) || roundIterations < 1 || roundIterations > ROUND_ITERATIONS || !Number.isInteger(rounds) || rounds < 1 || rounds > 20) return false;
  const salt = hexToBytes(saltText ?? "");
  const expected = hexToBytes(hashText ?? "");
  if (!salt || salt.length < 16 || !expected || expected.length !== 32) return false;
  const derived = await deriveChained(encoder.encode(password), salt, roundIterations, rounds);
  return crypto.subtle.timingSafeEqual(derived, expected);
}
