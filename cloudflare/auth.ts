const PASSWORD_ALGORITHM = "pbkdf2-sha256";
const PASSWORD_ITERATIONS = 100_000;
const SESSION_VERSION = 1;
export const SESSION_LIFETIME_SECONDS = 8 * 60 * 60;
export const SESSION_COOKIE_NAME = "squora_referee_session";

const encoder = new TextEncoder();

function hexToBytes(value: string): Uint8Array | null {
  if (value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function toBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  if (password.length === 0 || password.length > 200) return false;
  const [algorithm, iterationsText, saltText, hashText, extra] = encodedHash.split("$");
  if (extra !== undefined || algorithm !== PASSWORD_ALGORITHM || Number(iterationsText) !== PASSWORD_ITERATIONS) return false;

  const salt = hexToBytes(saltText ?? "");
  const expected = hexToBytes(hashText ?? "");
  if (!salt || salt.length !== 16 || !expected || expected.length !== 32) return false;

  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PASSWORD_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  return crypto.subtle.timingSafeEqual(new Uint8Array(derived), expected);
}

interface SessionPayload {
  v: number;
  sub: string;
  iat: number;
  exp: number;
}

function isSessionPayload(value: unknown): value is SessionPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<SessionPayload>;
  return payload.v === SESSION_VERSION && typeof payload.sub === "string" && typeof payload.iat === "number" && typeof payload.exp === "number";
}

export async function createSession(email: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<string> {
  const payload: SessionPayload = {
    v: SESSION_VERSION,
    sub: email,
    iat: nowSeconds,
    exp: nowSeconds + SESSION_LIFETIME_SECONDS,
  };
  const encodedPayload = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await importHmacKey(secret), encoder.encode(encodedPayload));
  return `${encodedPayload}.${toBase64Url(new Uint8Array(signature))}`;
}

/** Returns the session subject (email) for a valid, unexpired, correctly signed token, otherwise null. */
export async function readSession(token: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<string | null> {
  if (token.length > 2048) return null;
  const [encodedPayload, encodedSignature, extra] = token.split(".");
  if (!encodedPayload || !encodedSignature || extra !== undefined) return null;
  const payloadBytes = fromBase64Url(encodedPayload);
  const signature = fromBase64Url(encodedSignature);
  if (!payloadBytes || !signature || signature.length !== 32) return null;

  const validSignature = await crypto.subtle.verify("HMAC", await importHmacKey(secret), signature, encoder.encode(encodedPayload));
  if (!validSignature) return null;

  try {
    const payload: unknown = JSON.parse(new TextDecoder().decode(payloadBytes));
    if (isSessionPayload(payload) && payload.iat <= nowSeconds && payload.exp > nowSeconds) return payload.sub;
    return null;
  } catch {
    return null;
  }
}

export async function verifySession(token: string, email: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<boolean> {
  return (await readSession(token, secret, nowSeconds)) === email;
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1 || part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return null;
}
