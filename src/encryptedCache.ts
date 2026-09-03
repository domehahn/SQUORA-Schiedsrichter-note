import { decryptString, encryptString } from "./crypto";
import { parseCloudData, type CloudData } from "./sync";

const DATABASE = "squora-schiri-secure-cache";
const STORE = "tenant-cache";

export interface EncryptedCacheRecord {
  tenantId: string;
  version: number;
  iv: string;
  ciphertext: string;
  updatedAt: string;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "tenantId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function record(tenantId: string): Promise<EncryptedCacheRecord | null> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(tenantId);
      request.onsuccess = () => resolve((request.result as EncryptedCacheRecord | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function hasEncryptedCache(tenantId: string): Promise<boolean> {
  try { return Boolean(await record(tenantId)); } catch { return false; }
}

export async function readEncryptedCache(tenantId: string, key: CryptoKey): Promise<CloudData | null> {
  try {
    const stored = await record(tenantId);
    if (!stored) return null;
    const plaintext = await decryptString(key, stored.iv, stored.ciphertext);
    return plaintext === null ? null : parseCloudData(JSON.parse(plaintext));
  } catch {
    return null;
  }
}

export async function writeEncryptedCache(tenantId: string, key: CryptoKey, data: CloudData): Promise<void> {
  const encrypted = await encryptString(key, JSON.stringify(data));
  const entry: EncryptedCacheRecord = { tenantId, version: 1, ...encrypted, updatedAt: new Date().toISOString() };
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(STORE, "readwrite").objectStore(STORE).put(entry);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function deleteEncryptedCache(tenantId: string): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(STORE, "readwrite").objectStore(STORE).delete(tenantId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
