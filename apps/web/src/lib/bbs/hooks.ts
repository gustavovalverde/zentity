"use client";

/**
 * BBS+ React Hooks
 *
 * Hooks for managing BBS+ credentials in React components.
 */

import type { BbsCredential } from "./types";

import { useCallback, useEffect, useReducer, useRef } from "react";

import {
  type CredentialMetadata,
  deleteBbsCredential,
  getBbsCredentialsWithMetadata,
  isBbsStorageAvailable,
} from "./client-storage";

/**
 * State for the useBbsCredentials hook.
 */
export interface BbsCredentialsState {
  /** List of stored wallet credentials */
  credentials: BbsCredential[];
  /** Credential metadata for quick display */
  metadata: CredentialMetadata[];
  /** Whether credentials are currently loading */
  isLoading: boolean;
  /** Error message if loading failed */
  error: string | null;
  /** Whether IndexedDB storage is available */
  isStorageAvailable: boolean;
  /** Refresh credentials from storage */
  refresh: () => Promise<void>;
  /** Delete a specific credential */
  deleteCredential: (credentialId: string) => Promise<void>;
}

interface State {
  credentials: BbsCredential[];
  metadata: CredentialMetadata[];
  isLoading: boolean;
  error: string | null;
  isStorageAvailable: boolean;
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
 *
 * @example
 * ```tsx
 * const { credentials, isLoading, error, deleteCredential } = useBbsCredentials(userId);
 *
 * if (isLoading) return <Spinner />;
 * if (error) return <Alert>{error}</Alert>;
 *
 * return credentials.map(c => <CredentialCard key={c.holder} credential={c} />);
 * ```
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
    refresh();

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
