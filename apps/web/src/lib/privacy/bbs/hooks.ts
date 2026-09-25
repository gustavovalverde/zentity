"use client";

import "client-only";

/**
 * BBS+ Client Credentials
 *
 * IndexedDB-backed storage for BBS+ wallet credentials and the React hook that
 * exposes them to components.
 *
 * Storage Design:
 * - Database: "zentity-bbs"
 * - Object Store: "credentials"
 * - Primary key: `${userId}:${credentialId}`
 * - Index: userId (for listing all user credentials)
 */

import type { BbsCredential, SerializedBbsCredential } from "./wire";

import { useCallback, useEffect, useReducer, useRef } from "react";

import { reportRejection } from "@/lib/async-handler";

import { deserializeCredential } from "./wire";

const DB_NAME = "zentity-bbs";
const DB_VERSION = 1;
const STORE_NAME = "credentials";
const CONNECTION_IDLE_TIMEOUT_MS = 30_000;

/**
 * Stored credential record with metadata.
 */
interface StoredCredentialRecord {
  /** Commitment salt for wallet credentials (base64-encoded) */
  commitmentSalt?: string;
  /** Serialized credential JSON */
  credential: SerializedBbsCredential;
  /** Unique credential ID derived from content */
  credentialId: string;
  /** Primary key: `${userId}:${credentialId}` */
  key: string;
  /** When the credential was stored */
  storedAt: number;
  /** User ID who owns this credential */
  userId: string;
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
 */
async function deleteBbsCredential(
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
function isBbsStorageAvailable(): boolean {
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
 * Credential metadata for quick display without full deserialization.
 */
interface CredentialMetadata {
  chainId?: number | undefined;
  hasCommitmentSalt: boolean;
  holder: string;
  id: string;
  issuedAt: string;
  issuer: string;
  network: string;
  storedAt: number;
  tier: number;
}

interface BbsCredentialsWithMetadata {
  credentials: BbsCredential[];
  metadata: CredentialMetadata[];
}

/**
 * Fetch credentials and metadata in a single IndexedDB transaction.
 */
async function getBbsCredentialsWithMetadata(
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

/**
 * State for the useBbsCredentials hook.
 */
interface BbsCredentialsState {
  /** List of stored wallet credentials */
  credentials: BbsCredential[];
  /** Delete a specific credential */
  deleteCredential: (credentialId: string) => Promise<void>;
  /** Error message if loading failed */
  error: string | null;
  /** Whether credentials are currently loading */
  isLoading: boolean;
  /** Whether IndexedDB storage is available */
  isStorageAvailable: boolean;
  /** Credential metadata for quick display */
  metadata: CredentialMetadata[];
  /** Refresh credentials from storage */
  refresh: () => Promise<void>;
}

interface State {
  credentials: BbsCredential[];
  error: string | null;
  isLoading: boolean;
  isStorageAvailable: boolean;
  metadata: CredentialMetadata[];
}

type Action =
  | { type: "LOAD_START" }
  | {
      type: "LOAD_SUCCESS";
      credentials: BbsCredential[];
      metadata: CredentialMetadata[];
    }
  | { type: "LOAD_ERROR"; error: string }
  | { type: "STORAGE_UNAVAILABLE" }
  | { type: "RESET" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "LOAD_START":
      return { ...state, isLoading: true, error: null };
    case "LOAD_SUCCESS":
      return {
        ...state,
        credentials: action.credentials,
        metadata: action.metadata,
        isLoading: false,
        error: null,
      };
    case "LOAD_ERROR":
      return { ...state, isLoading: false, error: action.error };
    case "STORAGE_UNAVAILABLE":
      return {
        ...state,
        isStorageAvailable: false,
        isLoading: false,
        error: "IndexedDB not available in this browser",
      };
    case "RESET":
      return {
        credentials: [],
        metadata: [],
        isLoading: false,
        error: null,
        isStorageAvailable: true,
      };
    default:
      return state;
  }
}

const initialState: State = {
  credentials: [],
  metadata: [],
  isLoading: true,
  error: null,
  isStorageAvailable: true,
};

/**
 * Hook to manage BBS+ credentials stored in IndexedDB.
 *
 * @param userId - The authenticated user's ID
 * @returns Credentials state and management functions
 */
export function useBbsCredentials(userId: string | null): BbsCredentialsState {
  const [state, dispatch] = useReducer(reducer, initialState);
  const abortControllerRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    // Abort any in-flight request
    abortControllerRef.current?.abort();

    if (!userId) {
      dispatch({ type: "RESET" });
      return;
    }

    if (!isBbsStorageAvailable()) {
      dispatch({ type: "STORAGE_UNAVAILABLE" });
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    dispatch({ type: "LOAD_START" });

    try {
      const { credentials, metadata } = await getBbsCredentialsWithMetadata(
        userId,
        controller.signal
      );
      dispatch({ type: "LOAD_SUCCESS", credentials, metadata });
    } catch (err) {
      // Ignore abort errors
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      dispatch({
        type: "LOAD_ERROR",
        error:
          err instanceof Error ? err.message : "Failed to load credentials",
      });
    }
  }, [userId]);

  const deleteCredentialFn = useCallback(
    async (credentialId: string) => {
      if (!userId) {
        return;
      }

      try {
        await deleteBbsCredential(userId, credentialId);
        await refresh();
      } catch (err) {
        dispatch({
          type: "LOAD_ERROR",
          error:
            err instanceof Error ? err.message : "Failed to delete credential",
        });
      }
    },
    [userId, refresh]
  );

  useEffect(() => {
    refresh().catch(reportRejection);

    return () => {
      abortControllerRef.current?.abort();
    };
  }, [refresh]);

  return {
    credentials: state.credentials,
    metadata: state.metadata,
    isLoading: state.isLoading,
    error: state.error,
    isStorageAvailable: state.isStorageAvailable,
    refresh,
    deleteCredential: deleteCredentialFn,
  };
}
