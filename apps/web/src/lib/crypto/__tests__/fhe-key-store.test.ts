import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import {
  FHE_KEY_DB_NAME,
  getStoredFheKeys,
  persistFheKeyId,
  persistFheKeys,
  resetFheKeyStoreForTests,
} from "@/lib/crypto/fhe-key-store";

const makeBytes = (value: number, length: number) =>
  Uint8Array.from({ length }, () => value);

beforeEach(async () => {
  resetFheKeyStoreForTests();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(FHE_KEY_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
  const storage = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
    clear: () => {
      storage.clear();
    },
  };
  Object.defineProperty(globalThis, "window", {
    value: { localStorage },
    configurable: true,
  });
  (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage =
    localStorage as Storage;
});

describe("fhe-key-store", () => {
  it("persists and retrieves FHE keys from IndexedDB", async () => {
    const payload = {
      clientKey: makeBytes(1, 8),
      publicKey: makeBytes(2, 8),
      serverKey: makeBytes(3, 8),
      createdAt: new Date().toISOString(),
    };

    await persistFheKeys(payload);

    const stored = await getStoredFheKeys();

    expect(stored?.clientKey).toEqual(payload.clientKey);
    expect(stored?.publicKey).toEqual(payload.publicKey);
    expect(stored?.serverKey).toEqual(payload.serverKey);
    expect(stored?.keyId).toBeUndefined();
  });

  it("updates keyId when persisting", async () => {
    const payload = {
      clientKey: makeBytes(4, 4),
      publicKey: makeBytes(5, 4),
      serverKey: makeBytes(6, 4),
      createdAt: new Date().toISOString(),
    };

    await persistFheKeys(payload);
    await persistFheKeyId("key-123");

    const stored = await getStoredFheKeys();
    expect(stored?.keyId).toBe("key-123");
  });
});
