"use client";

/**
 * FHEVM SDK Hook
 *
 * Manages the FHEVM SDK instance lifecycle for Fully Homomorphic Encryption (FHE)
 * operations on EVM-compatible chains.
 *
 * ## What is fhEVM?
 * fhEVM enables encrypted computations on Ethereum. Smart contracts can operate
 * on encrypted data (euint64, ebool, etc.) without ever seeing plaintext values.
 *
 * ## SDK Lifecycle
 * 1. **Loading**: Provider adapter loads any required SDK assets
 * 2. **Initializing**: SDK connects to chain and fetches contract addresses
 * 3. **Ready**: Instance available for encrypt/decrypt operations
 *
 * ## Mock vs Production
 * - **Hardhat (chainId 31337)**: Uses MockFhevmInstance for local testing
 *   - No real encryption, but mimics SDK behavior
 *   - Requires @fhevm/hardhat-plugin running locally
 * - **Sepolia/Mainnet**: Uses a provider adapter with real FHE support
 *   - Connects to the FHEVM gateway for decryption
 *   - Loads any vendor SDK assets as needed
 *
 * @example
 * ```tsx
 * const { instance, status } = useFhevmSdk({
 *   provider: window.ethereum,
 *   chainId: 11155111, // Sepolia
 * });
 *
 * if (status === "ready" && instance) {
 *   // Ready to encrypt/decrypt
 * }
 * ```
 */
import type { FhevmGoState, FhevmInstance } from "@/lib/fhevm/types";

import { useCallback, useEffect, useRef, useState } from "react";

import { resolveFhevmProviderFactory } from "@/lib/fhevm/providers/registry";
import { recordClientMetric } from "@/lib/observability/client-metrics";

function assert(condition: boolean, message?: string): asserts condition {
  if (!condition) {
    const m = message ? `Assertion failed: ${message}` : "Assertion failed.";
    throw new Error(m);
  }
}

/** EIP-1193 provider interface (window.ethereum standard) */
interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

/** Internal SDK initialization stages for debugging */
type FhevmRelayerStatusType =
  | "sdk-loading"
  | "sdk-loaded"
  | "sdk-initializing"
  | "sdk-initialized"
  | "creating";

interface UseFhevmSdkParams {
  /** EIP-1193 provider (window.ethereum or wallet provider) */
  provider: unknown | undefined;
  /** Current chain ID - triggers re-init on change */
  chainId: number | undefined;
  /** Enable/disable SDK initialization (default: true) */
  enabled?: boolean;
  /** Map of chainId → RPC URL for mock chains (Hardhat testing) */
  initialMockChains?: Readonly<Record<number, string>>;
  /** Provider implementation ID (e.g., "zama", "mock", "customVendor") */
  providerId?: string;
}

interface UseFhevmSdkReturn {
  /** SDK instance when ready, undefined otherwise */
  instance: FhevmInstance | undefined;
  /** Force re-initialization (e.g., after chain switch) */
  refresh: () => void;
  /** Initialization error if any */
  error: Error | undefined;
  /** Current lifecycle state: idle → loading → ready/error */
  status: FhevmGoState;
}

export function useFhevmSdk(parameters: UseFhevmSdkParams): UseFhevmSdkReturn {
  const {
    provider,
    chainId,
    initialMockChains,
    enabled = true,
    providerId,
  } = parameters;

  const [instance, setInstance] = useState<FhevmInstance | undefined>(
    undefined
  );
  const [status, setStatus] = useState<FhevmGoState>("idle");
  const [error, setError] = useState<Error | undefined>(undefined);
  const [isRunning, setIsRunning] = useState<boolean>(enabled);
  const [refreshCount, setRefreshCount] = useState<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const providerRef = useRef<unknown | undefined>(provider);
  const chainIdRef = useRef<number | undefined>(chainId);
  const mockChainsRef = useRef<Record<number, string> | undefined>(
    initialMockChains as Record<number, string> | undefined
  );

  const refresh = useCallback(() => {
    // Abort any in-progress initialization
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Update refs with current values
    providerRef.current = provider;
    chainIdRef.current = chainId;
    mockChainsRef.current = initialMockChains as
      | Record<number, string>
      | undefined;

    // Reset state
    setInstance(undefined);
    setError(undefined);
    setStatus("idle");

    // Trigger re-initialization via refreshCount change
    setRefreshCount((prev) => prev + 1);
  }, [provider, chainId, initialMockChains]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: providerId must trigger SDK refresh
  useEffect(() => {
    refresh();
  }, [refresh, providerId]);

  // Keep mock chains in sync if config changes after mount
  useEffect(() => {
    mockChainsRef.current = initialMockChains as
      | Record<number, string>
      | undefined;
  }, [initialMockChains]);

  useEffect(() => {
    setIsRunning(enabled);
  }, [enabled]);

  // refreshCount is intentionally in deps to trigger re-initialization on refresh()
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshCount triggers re-init
  useEffect(() => {
    if (!isRunning) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      setInstance(undefined);
      setError(undefined);
      setStatus("idle");
      return;
    }

    if (providerRef.current === undefined) {
      setInstance(undefined);
      setError(undefined);
      setStatus("idle");
      return;
    }

    if (!abortControllerRef.current) {
      abortControllerRef.current = new AbortController();
    }

    assert(
      !abortControllerRef.current.signal.aborted,
      "Controller should not be aborted"
    );

    setStatus("loading");
    setError(undefined);

    const thisSignal = abortControllerRef.current.signal;
    const thisProvider = providerRef.current;
    const thisMockChains = mockChainsRef.current;

    const onStatusChange = (_s: FhevmRelayerStatusType) => {
      if (process.env.NODE_ENV === "development") {
        /* Debug logging placeholder for SDK status transitions */
      }
    };

    createFhevmInstance({
      signal: thisSignal,
      provider: thisProvider,
      mockChains: thisMockChains,
      onStatusChange,
      providerId,
    })
      .then((i) => {
        if (thisSignal.aborted) {
          return;
        }
        assert(
          thisProvider === providerRef.current,
          "Provider should not change"
        );

        setInstance(i);
        setError(undefined);
        setStatus("ready");
      })
      .catch((e) => {
        if (thisSignal.aborted) {
          return;
        }
        assert(
          thisProvider === providerRef.current,
          "Provider should not change"
        );

        setInstance(undefined);
        setError(e as Error);
        setStatus("error");
      });
  }, [isRunning, refreshCount]);

  return { instance, refresh, error, status };
}

interface CreateFhevmInstanceParams {
  provider: unknown;
  mockChains?: Record<number, string>;
  signal: AbortSignal;
  onStatusChange?: (status: FhevmRelayerStatusType) => void;
  providerId?: string;
}

/** Thrown when SDK initialization is cancelled (e.g., chain switch mid-init) */
class FhevmAbortError extends Error {
  constructor(message = "FHEVM SDK operation was cancelled") {
    super(message);
    this.name = "FhevmAbortError";
  }
}

/**
 * Create a FHEVM SDK instance for FHE operations.
 *
 * This handles the async SDK initialization flow:
 * 1. Check if running on mock chain (Hardhat) vs production
 * 2. For mock: create MockFhevmInstance that simulates FHE locally
 * 3. For production: initialize WASM modules and connect to the FHEVM gateway
 *
 * The instance provides:
 * - `createEncryptedInput()` - Encrypt values before sending to contracts
 * - `userDecrypt()` - Decrypt values with user's signature authorization
 */
async function createFhevmInstance(
  parameters: CreateFhevmInstanceParams
): Promise<FhevmInstance> {
  const start = performance.now();
  let result: "ok" | "error" | "aborted" = "ok";
  let providerIdAttr: string | undefined;
  let chainTypeAttr: "mock" | "real" | undefined;
  const {
    signal,
    onStatusChange,
    provider: providerOrUrl,
    mockChains,
    providerId,
  } = parameters;

  const throwIfAborted = () => {
    if (signal.aborted) {
      throw new FhevmAbortError();
    }
  };

  const notify = (status: FhevmRelayerStatusType) => {
    if (onStatusChange) {
      onStatusChange(status);
    }
  };

  // Hardhat local node (chainId 31337) uses mock FHE for testing
  // Real encryption would require the FHEVM coprocessor which only runs on testnet/mainnet
  const defaultMockChains: Record<number, string> = {
    31337: "http://127.0.0.1:8545",
    ...(mockChains ?? {}),
  };

  // Query chainId from provider to determine mock vs production
  if (typeof providerOrUrl === "string") {
    throw new Error("String RPC URLs not supported, use window.ethereum");
  }
  try {
    const chainIdHex = await (providerOrUrl as Eip1193Provider).request({
      method: "eth_chainId",
    });
    const chainId = Number.parseInt(chainIdHex as string, 16);

    const resolvedProviderId =
      providerId || process.env.NEXT_PUBLIC_FHEVM_PROVIDER_ID || "zama";

    const isMockChain = Object.hasOwn(defaultMockChains, chainId);
    const effectiveProviderId =
      resolvedProviderId === "mock" || isMockChain
        ? "mock"
        : resolvedProviderId;

    providerIdAttr = effectiveProviderId;
    chainTypeAttr = isMockChain ? "mock" : "real";

    if (resolvedProviderId === "mock" && !isMockChain) {
      throw new Error(
        "Mock FHEVM provider requires a configured mock chain RPC URL"
      );
    }

    const providerFactory = resolveFhevmProviderFactory(effectiveProviderId);
    if (!providerFactory) {
      throw new Error(`FHEVM provider not registered: ${effectiveProviderId}`);
    }

    notify("sdk-loading");
    const instance = await providerFactory({
      provider: providerOrUrl,
      chainId,
      rpcUrl: isMockChain ? defaultMockChains[chainId] : undefined,
      signal,
    });
    throwIfAborted();
    notify("sdk-initialized");
    notify("creating");

    return instance;
  } catch (error) {
    if (error instanceof FhevmAbortError) {
      result = "aborted";
    } else {
      result = "error";
    }
    throw error;
  } finally {
    const attributes: Record<string, string | number | boolean> = {
      result,
    };
    if (providerIdAttr) {
      attributes.provider_id = providerIdAttr;
    }
    if (chainTypeAttr) {
      attributes.chain_type = chainTypeAttr;
    }
    recordClientMetric({
      name: "client.fhevm.init.duration",
      value: performance.now() - start,
      attributes,
    });
  }
}
