"use client";

import { useAppKitAccount } from "@reown/appkit/react";
/**
 * FhevmProvider
 *
 * Provides the FHEVM SDK instance context for client-side FHE operations.
 * Must be used inside WagmiProvider to access wallet connection state.
 */
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useChainId } from "wagmi";

import "@/lib/fhevm/providers/global";

import type { FhevmGoState, FhevmInstance } from "@/lib/fhevm/types";

import { useFhevmSdk } from "@/hooks/fhevm/use-fhevm-sdk";
import { useIsMounted } from "@/hooks/use-is-mounted";

export interface FhevmContextValue {
  /** The FHEVM SDK instance for encryption/decryption operations */
  instance: FhevmInstance | undefined;
  /** Current loading state */
  status: FhevmGoState;
  /** Error if initialization failed */
  error: Error | undefined;
  /** Whether the FHEVM SDK instance is ready for use */
  isReady: boolean;
  /** Whether the instance is currently loading */
  isLoading: boolean;
  /** Refresh the FHEVM SDK instance (e.g., after chain switch) */
  refresh: () => void;
}

const FhevmContext = createContext<FhevmContextValue | undefined>(undefined);

interface FhevmProviderProps {
  children: ReactNode;
  /** Mock chain configurations for development */
  mockChains?: Readonly<Record<number, string>>;
}

/**
 * Provides FHEVM SDK instance to the application.
 *
 * The instance is automatically created when a wallet is connected
 * and the chain supports FHE operations.
 *
 * @example
 * ```tsx
 * // In your app layout, wrap with FhevmProvider (inside WagmiProvider)
 * <FhevmProvider>
 *   <App />
 * </FhevmProvider>
 *
 * // In components, use the hook
 * const { instance, isReady } = useFhevmContext();
 * if (isReady && instance) {
 *   // Perform FHE operations
 * }
 * ```
 */
export function FhevmProvider({
  children,
  mockChains,
}: Readonly<FhevmProviderProps>) {
  const chainId = useChainId();
  const { isConnected } = useAppKitAccount();
  const isMounted = useIsMounted();
  const providerId = process.env.NEXT_PUBLIC_FHEVM_PROVIDER_ID;

  // Track provider in state so late-injected providers trigger re-render
  const [provider, setProvider] = useState<unknown | undefined>(undefined);

  useEffect(() => {
    if (!(isMounted && isConnected) || globalThis.window === undefined) {
      setProvider(undefined);
      return;
    }

    if (globalThis.window.ethereum) {
      setProvider(globalThis.window.ethereum);
      return;
    }

    setProvider(undefined);
  }, [isMounted, isConnected]);

  useEffect(() => {
    if (
      provider ||
      !isMounted ||
      !isConnected ||
      globalThis.window === undefined
    ) {
      return;
    }

    const interval = globalThis.window.setInterval(() => {
      if (globalThis.window.ethereum) {
        setProvider(globalThis.window.ethereum);
        globalThis.window.clearInterval(interval);
        return;
      }
    }, 200);

    return () => globalThis.window.clearInterval(interval);
  }, [provider, isMounted, isConnected]);

  // Default mock chains for development
  const defaultMockChains: Readonly<Record<number, string>> = useMemo(
    () => ({
      31337: "http://127.0.0.1:8545", // Hardhat
      ...(mockChains ?? {}),
    }),
    [mockChains]
  );

  const { instance, status, error, refresh } = useFhevmSdk({
    provider,
    chainId,
    enabled: Boolean(isConnected && provider),
    initialMockChains: defaultMockChains,
    providerId,
  });

  const value = useMemo<FhevmContextValue>(
    () => ({
      instance,
      status,
      error,
      isReady: status === "ready",
      isLoading: status === "loading",
      refresh,
    }),
    [instance, status, error, refresh]
  );

  return (
    <FhevmContext.Provider value={value}>{children}</FhevmContext.Provider>
  );
}

/**
 * Hook to access the FHEVM SDK context.
 *
 * @throws Error if used outside of FhevmProvider
 */
export function useFhevmContext(): FhevmContextValue {
  const context = useContext(FhevmContext);
  if (context === undefined) {
    throw new Error("useFhevmContext must be used within a FhevmProvider");
  }
  return context;
}
