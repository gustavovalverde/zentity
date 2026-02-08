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
} from "@/lib/auth/webauthn-prf";

interface PasskeyAuthState {
  /** Whether PRF extension is supported by this device/browser */
  prfSupport: PrfSupportStatus | null;
}

interface PasskeyAuthContextValue extends PasskeyAuthState {
  /** Check PRF support without triggering unlock */
  checkSupport: () => Promise<PrfSupportStatus>;
  /** Clear cached state (call on logout) */
  clear: () => void;
}

const PasskeyAuthContext = createContext<PasskeyAuthContextValue | null>(null);

interface PasskeyAuthProviderProps {
  readonly children: ReactNode;
}

export function PasskeyAuthProvider({
  children,
}: Readonly<PasskeyAuthProviderProps>) {
  const [state, setState] = useState<PasskeyAuthState>({
    prfSupport: null,
  });

  // Cache PRF support check to avoid repeated calls
  const prfSupportPromiseRef = useRef<Promise<PrfSupportStatus> | null>(null);

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

  const clear = useCallback(() => {
    setState({
      prfSupport: state.prfSupport,
    });
  }, [state.prfSupport]);

  const value = useMemo<PasskeyAuthContextValue>(
    () => ({
      ...state,
      checkSupport,
      clear,
    }),
    [state, checkSupport, clear]
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
