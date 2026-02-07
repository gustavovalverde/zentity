"use client";

import "client-only";

/**
 * BBS+ Client-Side Credential Storage
 *
 * IndexedDB-backed storage for BBS+ credentials.
 *
 * Storage Design:
 * - Database: "zentity-bbs"
 * - Object Store: "credentials"
 * - Primary key: `${userId}:${credentialId}`
 * - Index: userId (for listing all user credentials)
 */

import type { BbsCredential } from "./types";

import {
  deserializeCredential,
  type SerializedBbsCredential,
} from "./serialization";

const DB_NAME = "zentity-bbs";
const DB_VERSION = 1;
const STORE_NAME = "credentials";
const CONNECTION_IDLE_TIMEOUT_MS = 30_000;

/**
 * Stored credential record with metadata.
 */
interface StoredCredentialRecord {
  /** Primary key: `${userId}:${credentialId}` */
  key: string;
  /** User ID who owns this credential */
  userId: string;
  /** Unique credential ID derived from content */
  credentialId: string;
  /** Serialized credential JSON */
  credential: SerializedBbsCredential;
  /** When the credential was stored */
  storedAt: number;
  /** Commitment salt for wallet credentials (base64-encoded) */
  commitmentSalt?: string;
}

// Connection pooling for IndexedDB
let cachedDbPromise: Promise<IDBDatabase> | null = null;
let idleTimeoutId: ReturnType<typeof setTimeout> | null = null;

function resetIdleTimeout() {
  if (idleTimeoutId) {
    clearTimeout(idleTimeoutId);
  }
  idleTimeoutId = setTimeout(() => {
    if (cachedDbPromise) {
      cachedDbPromise
        .then((db) => db.close())
        .catch(() => {
          // Ignore close errors - connection may already be closed
        });
      cachedDbPromise = null;
    }
    idleTimeoutId = null;
  }, CONNECTION_IDLE_TIMEOUT_MS);
}

/**
 * Get a persistent IndexedDB connection.
 * Uses connection pooling to avoid repeated open/close overhead.
 */
function getDatabase(): Promise<IDBDatabase> {
  resetIdleTimeout();

  if (cachedDbPromise) {
    return cachedDbPromise;
  }

  cachedDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      cachedDbPromise = null;
      reject(
        new Error(`Failed to open BBS+ database: ${request.error?.message}`)
      );
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onclose = () => {
        cachedDbPromise = null;
      };
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });
        store.createIndex("userId", "userId", { unique: false });
      }
    };
  });

  return cachedDbPromise;
}

/**
 * Delete a BBS+ credential.
 *
 * @param userId - Owner's user ID
 * @param credentialId - Credential ID to delete
 */
export async function deleteBbsCredential(
  userId: string,
  credentialId: string
): Promise<void> {
  const db = await getDatabase();
  const key = `${userId}:${credentialId}`;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(key);

    request.onsuccess = () => resolve();
    request.onerror = () =>
      reject(
        new Error(`Failed to delete credential: ${request.error?.message}`)
      );
  });
}

/**
 * Check if the BBS+ credential database is available.
 * Returns false if IndexedDB is not supported or blocked.
 */
export function isBbsStorageAvailable(): boolean {
  if (typeof globalThis.window === "undefined") {
    return false;
  }

  try {
    return "indexedDB" in globalThis && globalThis.indexedDB !== null;
  } catch {
    return false;
  }
}

/**
 * Get credential metadata without full deserialization.
 */
export interface CredentialMetadata {
  id: string;
  issuer: string;
  holder: string;
  issuedAt: string;
  network: string;
  chainId?: number;
  tier: number;
  storedAt: number;
  hasCommitmentSalt: boolean;
}

/**
 * Combined result type for credentials and metadata.
 */
export interface BbsCredentialsWithMetadata {
  credentials: BbsCredential[];
  metadata: CredentialMetadata[];
}

/**
 * Fetch credentials and metadata in a single IndexedDB transaction.
 * More efficient than two separate calls.
 *
 * @param userId - Owner's user ID
 * @param signal - Optional AbortSignal for cancellation
 */
export async function getBbsCredentialsWithMetadata(
  userId: string,
  signal?: AbortSignal
): Promise<BbsCredentialsWithMetadata> {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const db = await getDatabase();

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const index = store.index("userId");
    const request = index.getAll(userId);

    const abortHandler = () => {
      tx.abort();
      reject(new DOMException("Aborted", "AbortError"));
    };

    signal?.addEventListener("abort", abortHandler, { once: true });

    request.onsuccess = () => {
      signal?.removeEventListener("abort", abortHandler);
      const records = request.result as StoredCredentialRecord[];

      const credentials = records.map((r) =>
        deserializeCredential(r.credential)
      );
      const metadata = records.map((r) => ({
        id: r.credentialId,
        issuer: r.credential.issuer,
        holder: r.credential.holder,
        issuedAt: r.credential.issuedAt,
        network: r.credential.subject.network,
        chainId: r.credential.subject.chainId,
        tier: r.credential.subject.tier,
        storedAt: r.storedAt,
        hasCommitmentSalt: Boolean(r.commitmentSalt),
      }));

      resolve({ credentials, metadata });
    };

    request.onerror = () => {
      signal?.removeEventListener("abort", abortHandler);
      reject(
        new Error(`Failed to retrieve credentials: ${request.error?.message}`)
      );
    };
  });
}
