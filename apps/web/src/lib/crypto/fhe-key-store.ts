"use client";

const DB_NAME = "zentity-fhe";
const STORE_NAME = "keypairs";
const RECORD_KEY = "default";

export const FHE_KEY_DB_NAME = DB_NAME;

// TODO(passkey): Replace IndexedDB persistence with WebAuthn/Passkey-wrapped key storage.

export interface StoredFheKeys {
  clientKey: Uint8Array;
  publicKey: Uint8Array;
  serverKey: Uint8Array;
  keyId?: string;
  createdAt: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function ensureIndexedDbAvailable() {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB is required for FHE key storage");
  }
}

function openDb(): Promise<IDBDatabase> {
  ensureIndexedDbAvailable();
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
    });
  }
  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readFromIndexedDb(): Promise<StoredFheKeys | null> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);
  const record = await requestToPromise<StoredFheKeys | undefined>(
    store.get(RECORD_KEY),
  );
  return record ?? null;
}

async function writeToIndexedDb(payload: StoredFheKeys): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  await requestToPromise(store.put(payload, RECORD_KEY));
}

export async function getStoredFheKeys(): Promise<StoredFheKeys | null> {
  return await readFromIndexedDb();
}

export async function persistFheKeys(payload: StoredFheKeys): Promise<void> {
  await writeToIndexedDb(payload);
}

export async function persistFheKeyId(keyId: string): Promise<void> {
  const existing = await getStoredFheKeys();
  if (!existing) return;
  await writeToIndexedDb({ ...existing, keyId });
}

export function resetFheKeyStoreForTests() {
  if (dbPromise) {
    dbPromise.then((db) => db.close()).catch(() => undefined);
  }
  dbPromise = null;
}
