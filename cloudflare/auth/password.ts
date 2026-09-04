import { pbkdf2 as nodePbkdf2 } from "node:crypto";

const encoder = new TextEncoder();

/**
 * Password hashing — PBKDF2-HMAC-SHA256, standard primitive, versioned format:
 *
 *   pbkdf2-sha256$i=<iterations>$<saltHex>$<hashHex>   (preferred — one call)
 *   pbkdf2-sha256$<n>*<r>$<saltHex>$<hashHex>          (interim — r chained rounds of n)
 *   pbkdf2-sha256$<n>$<saltHex>$<hashHex>              (legacy — one round of n)
 *
 * The WebCrypto (`crypto.subtle`) PBKDF2 implementation in the Workers runtime
 * rejects a single call above 100 000 iterations, which is why the interim
 * format chains rounds. `node:crypto.pbkdf2` (with `nodejs_compat`) has no such
 * cap; when it is available we hash new/rotated passwords in one 600 000-round
 * call. Availability is probed once per isolate; if `node:crypto` PBKDF2 is not
 * usable the code falls back to the chained construction so nothing breaks.
 *
 * Migration is rehash-on-login: `verifyPassword` reports `needsRehash` whenever
 * the stored hash is not in the currently preferred shape, and the caller
 * writes a fresh hash. No forced password reset.
 */
const WEBCRYPTO_MAX_ITERATIONS = 100_000;
const INTERIM_ROUNDS = 6;
const STANDARD_ITERATIONS = 600_000;
const KEY_BYTES = 32;

export const PASSWORD_PARAMS = `i=${STANDARD_ITERATIONS}`;

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value: string): Uint8Array | null {
  if (value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

/** Single-call PBKDF2 via node:crypto. Rejects if the runtime lacks it. */
function pbkdf2NodeOnce(password: Uint8Array, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    nodePbkdf2(Buffer.from(password), Buffer.from(salt), iterations, KEY_BYTES, "sha256", (error, derived) => {
      if (error) reject(error);
      else resolve(new Uint8Array(derived));
    });
  });
}

/** r chained rounds of WebCrypto PBKDF2, each `roundIterations` (≤ 100 000). */
async function pbkdf2Chained(password: Uint8Array, salt: Uint8Array, roundIterations: number, rounds: number): Promise<Uint8Array> {
  let material = password;
  let out = new Uint8Array(KEY_BYTES);
  for (let round = 0; round < rounds; round += 1) {
    const key = await crypto.subtle.importKey("raw", material as BufferSource, "PBKDF2", false, ["deriveBits"]);
    out = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: roundIterations }, key, KEY_BYTES * 8));
    material = out;
  }
  return out;
}

let nodePbkdf2Usable: boolean | null = null;

/** Probe once whether node:crypto PBKDF2 works in this isolate. */
async function canUseNodePbkdf2(): Promise<boolean> {
  if (nodePbkdf2Usable === null) {
    try {
      await pbkdf2NodeOnce(encoder.encode("probe"), new Uint8Array(16), 1000);
      nodePbkdf2Usable = true;
    } catch {
      nodePbkdf2Usable = false;
    }
  }
  return nodePbkdf2Usable;
}

/** Hash a password in the currently preferred format. */
export async function hashPassword(password: string): Promise<string> {
  if (!password || password.length < 12 || password.length > 1024) {
    throw new Error("Password must be between 12 and 1024 characters.");
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  if (await canUseNodePbkdf2()) {
    const hash = await pbkdf2NodeOnce(encoder.encode(password), salt, STANDARD_ITERATIONS);
    return `pbkdf2-sha256$i=${STANDARD_ITERATIONS}$${toHex(salt)}$${toHex(hash)}`;
  }
  const hash = await pbkdf2Chained(encoder.encode(password), salt, WEBCRYPTO_MAX_ITERATIONS, INTERIM_ROUNDS);
  return `pbkdf2-sha256$${WEBCRYPTO_MAX_ITERATIONS}*${INTERIM_ROUNDS}$${toHex(salt)}$${toHex(hash)}`;
}

interface ParsedHash {
  salt: Uint8Array;
  expected: Uint8Array;
  derive: (password: Uint8Array, salt: Uint8Array) => Promise<Uint8Array>;
  preferred: boolean;
}

function parseHash(encodedHash: string): ParsedHash | null {
  const [algorithm, paramsText, saltText, hashText, extra] = encodedHash.split("$");
  if (extra !== undefined || algorithm !== "pbkdf2-sha256") return null;
  const salt = hexToBytes(saltText ?? "");
  const expected = hexToBytes(hashText ?? "");
  if (!salt || salt.length < 16 || !expected || expected.length !== KEY_BYTES) return null;

  const params = paramsText ?? "";
  if (params.startsWith("i=")) {
    const iterations = Number(params.slice(2));
    if (!Number.isInteger(iterations) || iterations < 100_000 || iterations > 5_000_000) return null;
    return { salt, expected, preferred: iterations === STANDARD_ITERATIONS, derive: (p, s) => pbkdf2NodeOnce(p, s, iterations) };
  }
  const [iterText, roundText] = params.split("*");
  const roundIterations = Number(iterText);
  const rounds = roundText === undefined ? 1 : Number(roundText);
  if (!Number.isInteger(roundIterations) || roundIterations < 1 || roundIterations > WEBCRYPTO_MAX_ITERATIONS || !Number.isInteger(rounds) || rounds < 1 || rounds > 20) return null;
  return { salt, expected, preferred: false, derive: (p, s) => pbkdf2Chained(p, s, roundIterations, rounds) };
}

/**
 * Verify a password against any supported hash format. `needsRehash` is true
 * when the stored hash is not in the currently preferred shape (or the preferred
 * KDF has become available since it was written) — the caller should then write
 * a fresh `hashPassword(password)` result.
 */
export async function verifyPassword(password: string, encodedHash: string): Promise<{ ok: boolean; needsRehash: boolean }> {
  if (!password || password.length > 1024) return { ok: false, needsRehash: false };
  const parsed = parseHash(encodedHash);
  if (!parsed) return { ok: false, needsRehash: false };
  let derived: Uint8Array;
  try {
    derived = await parsed.derive(encoder.encode(password), parsed.salt);
  } catch {
    return { ok: false, needsRehash: false };
  }
  const ok = derived.length === parsed.expected.length && crypto.subtle.timingSafeEqual(derived, parsed.expected);
  const needsRehash = ok && (!parsed.preferred && await canUseNodePbkdf2());
  return { ok, needsRehash };
}
