"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  checkPrfSupport,
  type PrfSupportStatus,
} from "@/lib/crypto/webauthn-prf";

/** TTL for cached PRF output (matches fhe-key-store.ts and profile-secret.ts) */
const PRF_CACHE_TTL_MS = 15 * 60 * 1000;

interface PasskeyAuthState {
  /** Whether PRF extension is supported by this device/browser */
  prfSupport: PrfSupportStatus | null;
  /** Cached PRF output from last successful unlock */
  prfOutput: Uint8Array | null;
  /** Credential ID that was used for the PRF output */
  credentialId: string | null;
  /** Timestamp of last successful unlock */
  lastUnlockedAt: number | null;
  /** Whether an unlock operation is in progress */
  isUnlocking: boolean;
  /** Last error from unlock attempt */
  error: Error | null;
}

interface PasskeyAuthContextValue extends PasskeyAuthState {
  /** Check if current PRF output is still valid (within TTL) */
  isValid: () => boolean;
  /** Check PRF support without triggering unlock */
  checkSupport: () => Promise<PrfSupportStatus>;
  /** Store PRF output after successful unlock (called by unlock hooks) */
  setPrfOutput: (output: Uint8Array, credentialId: string) => void;
  /** Set unlocking state */
  setIsUnlocking: (value: boolean) => void;
  /** Set error state */
  setError: (error: Error | null) => void;
  /** Clear cached PRF output (call on logout) */
  clear: () => void;
}

const PasskeyAuthContext = createContext<PasskeyAuthContextValue | null>(null);

interface PasskeyAuthProviderProps {
  readonly children: ReactNode;
}

export function PasskeyAuthProvider({ children }: PasskeyAuthProviderProps) {
  const [state, setState] = useState<PasskeyAuthState>({
    prfSupport: null,
    prfOutput: null,
    credentialId: null,
    lastUnlockedAt: null,
    isUnlocking: false,
    error: null,
  });

  // Cache PRF support check to avoid repeated calls
  const prfSupportPromiseRef = useRef<Promise<PrfSupportStatus> | null>(null);

  const isValid = useCallback(() => {
    if (!(state.prfOutput && state.lastUnlockedAt)) {
      return false;
    }
    return Date.now() - state.lastUnlockedAt < PRF_CACHE_TTL_MS;
  }, [state.prfOutput, state.lastUnlockedAt]);

  const checkSupport = useCallback((): Promise<PrfSupportStatus> => {
    // Return cached result if available
    if (state.prfSupport !== null) {
      return Promise.resolve(state.prfSupport);
    }

    // Deduplicate concurrent calls
    prfSupportPromiseRef.current ??= checkPrfSupport().then((result) => {
      setState((prev) => ({ ...prev, prfSupport: result }));
      prfSupportPromiseRef.current = null;
      return result;
    });

    return prfSupportPromiseRef.current;
  }, [state.prfSupport]);

  const setPrfOutput = useCallback(
    (output: Uint8Array, credentialId: string) => {
      setState((prev) => ({
        ...prev,
        prfOutput: output,
        credentialId,
        lastUnlockedAt: Date.now(),
        isUnlocking: false,
        error: null,
      }));
    },
    []
  );

  const setIsUnlocking = useCallback((unlocking: boolean) => {
    setState((prev) => ({ ...prev, isUnlocking: unlocking }));
  }, []);

  const setError = useCallback((error: Error | null) => {
    setState((prev) => ({ ...prev, error, isUnlocking: false }));
  }, []);

  const clear = useCallback(() => {
    setState({
      prfSupport: state.prfSupport, // Keep PRF support status
      prfOutput: null,
      credentialId: null,
      lastUnlockedAt: null,
      isUnlocking: false,
      error: null,
    });
  }, [state.prfSupport]);

  const value = useMemo<PasskeyAuthContextValue>(
    () => ({
      ...state,
      isValid,
      checkSupport,
      setPrfOutput,
      setIsUnlocking,
      setError,
      clear,
    }),
    [
      state,
      isValid,
      checkSupport,
      setPrfOutput,
      setIsUnlocking,
      setError,
      clear,
    ]
  );

  return (
    <PasskeyAuthContext.Provider value={value}>
      {children}
    </PasskeyAuthContext.Provider>
  );
}

/**
 * Hook to access passkey authentication context.
 * Must be used within a PasskeyAuthProvider.
 */
export function usePasskeyAuth(): PasskeyAuthContextValue {
  const context = useContext(PasskeyAuthContext);
  if (!context) {
    throw new Error("usePasskeyAuth must be used within PasskeyAuthProvider");
  }
  return context;
}
