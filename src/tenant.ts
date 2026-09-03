import { decryptString, deriveKey, encryptString, fromBase64, randomBytes, toBase64 } from "./crypto";

const VERIFIER_PLAINTEXT = "squora-verein-v1";

export interface TenantMeta {
  id: string;
  name: string;
  salt: string;
  verifierIv: string;
  verifier: string;
  createdAt: string;
}

export interface TenantIndex {
  updatedAt: string | null;
  tenants: TenantMeta[];
}

export function newTenantId(): string {
  const raw = toBase64(randomBytes(12)).replace(/[^A-Za-z0-9]/g, "");
  return (raw + Math.random().toString(36).slice(2)).slice(0, 16);
}

/** Creates the passphrase-derived key and the public metadata (salt + verifier blob) for a new Verein. */
export async function createTenant(name: string, passphrase: string): Promise<{ meta: TenantMeta; key: CryptoKey }> {
  const salt = randomBytes(16);
  const key = await deriveKey(passphrase, salt);
  const verifier = await encryptString(key, VERIFIER_PLAINTEXT);
  return {
    key,
    meta: {
      id: newTenantId(),
      name: name.trim() || "Verein",
      salt: toBase64(salt),
      verifierIv: verifier.iv,
      verifier: verifier.ciphertext,
      createdAt: new Date().toISOString(),
    },
  };
}

/** Returns the decryption key if the passphrase matches the stored verifier, otherwise null. */
export async function unlockTenant(meta: TenantMeta, passphrase: string): Promise<CryptoKey | null> {
  try {
    const key = await deriveKey(passphrase, fromBase64(meta.salt));
    const plain = await decryptString(key, meta.verifierIv, meta.verifier);
    return plain === VERIFIER_PLAINTEXT ? key : null;
  } catch {
    return null;
  }
}

function isTenantMeta(value: unknown): value is TenantMeta {
  const meta = value as Partial<TenantMeta> | undefined;
  return Boolean(
    meta &&
      typeof meta.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(meta.id) &&
      typeof meta.name === "string" &&
      typeof meta.salt === "string" &&
      typeof meta.verifierIv === "string" &&
      typeof meta.verifier === "string",
  );
}

export function sanitizeTenantIndex(value: unknown): TenantIndex {
  const source = value as Partial<TenantIndex> | undefined;
  const tenants = Array.isArray(source?.tenants)
    ? source!.tenants.filter(isTenantMeta).map((meta) => ({
        id: meta.id,
        name: String(meta.name).slice(0, 80) || "Verein",
        salt: meta.salt,
        verifierIv: meta.verifierIv,
        verifier: meta.verifier,
        createdAt: typeof meta.createdAt === "string" ? meta.createdAt : new Date().toISOString(),
      }))
    : [];
  return { updatedAt: typeof source?.updatedAt === "string" ? source!.updatedAt : null, tenants };
}

/** Union by id; a locally-created Verein missing from the server is kept, server metadata wins on conflict. */
export function mergeTenantIndex(local: TenantIndex, remote: TenantIndex): TenantIndex {
  const byId = new Map<string, TenantMeta>();
  for (const meta of local.tenants) byId.set(meta.id, meta);
  for (const meta of remote.tenants) byId.set(meta.id, meta);
  return {
    updatedAt: remote.updatedAt ?? local.updatedAt,
    tenants: [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "de")),
  };
}
