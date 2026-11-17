"use client";

import type {
  EncryptResult,
  ZamaSDKEvent,
  ZamaSDKEventType,
} from "@zama-fhe/sdk";
import type { FheChain } from "@zama-fhe/sdk/chains";
import type { ReactNode } from "react";
import type { EIP1193Provider } from "viem";

import { useAppKitAccount } from "@reown/appkit/react";
import { cleartext, MemoryStorage, ZamaSDK } from "@zama-fhe/sdk";
import { createConfig } from "@zama-fhe/sdk/viem";
import { web } from "@zama-fhe/sdk/web";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useChainId, usePublicClient, useWalletClient } from "wagmi";

import { recordClientMetric } from "@/lib/observability/client-metrics";

import {
  getConfidentialClientNetwork,
  resolveHardhatFhevmChain,
} from "./client-networks";
import {
  buildEncryptedIdentityAttributes,
  buildIdentityAttributeDecryptHandles,
  type DecryptedIdentityAttributes,
  deriveDecryptedIdentityAttributes,
  type EncryptedIdentityAttributes,
  type IdentityAttributeHandles,
  type IdentityAttributesForAttestation,
} from "./identity-attributes";
import {
  buildEncryptedTokenAmount,
  type EncryptedTokenAmount,
} from "./token-amount";

export const CONFIDENTIAL_SESSION_TTL_SECONDS = 86_400;
const CONFIDENTIAL_PERMIT_TTL_DAYS = CONFIDENTIAL_SESSION_TTL_SECONDS / 86_400;
const CONFIDENTIAL_TRANSPORT_KEY_PAIR_TTL_SECONDS = 30 * 86_400;
const confidentialLogger =
  process.env.NODE_ENV === "development" ? console : undefined;
// Earlier releases gave the SDK this IndexedDB database, where it kept
// decrypted identity attributes across sessions.
const LEGACY_SDK_DATABASE = "ZentityConfidentialCredentials";

type ConfidentialChainStatus =
  | "error"
  | "initializing"
  | "not_connected"
  | "ready";

interface ConfidentialChainContextValue {
  decryptIdentityAttributes: (input: {
    attributeHandles: IdentityAttributeHandles;
    registryAddress: `0x${string}`;
  }) => Promise<DecryptedIdentityAttributes>;
  encryptIdentityAttributesForAttestation: (input: {
    attributes: IdentityAttributesForAttestation;
    registryAddress: `0x${string}`;
    userAddress: `0x${string}`;
  }) => Promise<EncryptedIdentityAttributes>;
  encryptTokenAmount: (input: {
    amount: bigint;
    contractAddress: `0x${string}`;
    userAddress: `0x${string}`;
  }) => Promise<EncryptedTokenAmount>;
  error: Error | null;
  isReady: boolean;
  refresh: () => void;
  status: ConfidentialChainStatus;
}

const ConfidentialChainContext =
  createContext<ConfidentialChainContextValue | null>(null);

function getBrowserEthereumProvider(): EIP1193Provider | undefined {
  if (globalThis.window === undefined) {
    return;
  }
  return globalThis.window.ethereum as EIP1193Provider | undefined;
}

function recordSdkEvent(event: ZamaSDKEvent) {
  if (
    event.type === ("decrypt:end" satisfies ZamaSDKEventType) ||
    event.type === ("decrypt:error" satisfies ZamaSDKEventType)
  ) {
    recordClientMetric({
      name: "client.confidential.decrypt.duration",
      value: event.durationMs,
      attributes: { result: event.type === "decrypt:end" ? "ok" : "error" },
    });
  }
}

function assertConfidentialSdk(
  sdk: ZamaSDK | null,
  setupError: Error | null
): asserts sdk is ZamaSDK {
  if (!sdk) {
    throw (
      setupError ??
      new Error(
        "Confidential chain client is not ready. Check wallet connection and network."
      )
    );
  }
}

async function runMeasuredEncrypt<T>(
  encrypt: () => Promise<EncryptResult>,
  build: (encryptedInput: EncryptResult) => T
): Promise<T> {
  const startTime = performance.now();
  let result: "ok" | "error" = "ok";
  try {
    const encryptedInput = await encrypt();
    recordClientMetric({
      name: "client.confidential.encrypt.proof.bytes",
      value: (encryptedInput.inputProof.length - 2) / 2,
    });
    return build(encryptedInput);
  } catch (encryptError) {
    result = "error";
    throw encryptError;
  } finally {
    recordClientMetric({
      name: "client.confidential.encrypt.duration",
      value: performance.now() - startTime,
      attributes: { result },
    });
  }
}

export function ConfidentialChainProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const activeChainId = useChainId();
  const publicClient = usePublicClient({ chainId: activeChainId });
  const { address, isConnected } = useAppKitAccount();
  const { data: walletClient } = useWalletClient({ chainId: activeChainId });

  const [sdk, setSdk] = useState<ZamaSDK | null>(null);
  const [status, setStatus] =
    useState<ConfidentialChainStatus>("not_connected");
  const [error, setError] = useState<Error | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    globalThis.indexedDB?.deleteDatabase(LEGACY_SDK_DATABASE);
  }, []);

  useEffect(() => {
    if (!(isConnected && address && publicClient && walletClient)) {
      setSdk(null);
      setStatus("not_connected");
      setError(null);
      return;
    }

    const initializationStartedAt = performance.now();
    const initializationTrigger = refreshKey === 0 ? "connect" : "refresh";
    const activeNetwork = getConfidentialClientNetwork(activeChainId);
    if (!activeNetwork) {
      setSdk(null);
      setStatus("error");
      setError(
        new Error(`Unsupported confidential chain ID: ${activeChainId}`)
      );
      return;
    }

    const createSdk = (chain: FheChain) =>
      new ZamaSDK(
        createConfig({
          chains: [chain],
          publicClient,
          walletClient,
          ethereum: getBrowserEthereumProvider(),
          relayers: {
            [chain.id]:
              activeNetwork.mode === "cleartext" ? cleartext() : web(),
          },
          // Decrypted values and the transport key pair stay in memory, so
          // identity attributes never persist in the browser.
          storage: new MemoryStorage(),
          permitStorage: new MemoryStorage(),
          transportKeyPairTTL: CONFIDENTIAL_TRANSPORT_KEY_PAIR_TTL_SECONDS,
          permitTTL: CONFIDENTIAL_PERMIT_TTL_DAYS,
          onEvent: recordSdkEvent,
          logger: confidentialLogger,
        })
      );

    let cancelled = false;
    let nextSdk: ZamaSDK | null = null;
    const recordInitialization = (result: "ok" | "error") => {
      recordClientMetric({
        name: "client.confidential.init.duration",
        value: performance.now() - initializationStartedAt,
        attributes: {
          result,
          chain_id: String(activeChainId),
          trigger: initializationTrigger,
        },
      });
    };

    const failInitialization = (initError: unknown) => {
      if (!cancelled) {
        setStatus("error");
        setError(
          initError instanceof Error ? initError : new Error(String(initError))
        );
        recordInitialization("error");
      }
    };

    setStatus("initializing");
    setError(null);
    if (activeNetwork.mode === "cleartext") {
      setSdk(null);
      resolveHardhatFhevmChain(activeNetwork.chain, publicClient)
        .then((chain) => {
          if (!cancelled) {
            nextSdk = createSdk(chain);
            setSdk(nextSdk);
            setStatus("ready");
            recordInitialization("ok");
          }
        })
        .catch(failInitialization);
    } else {
      const relayerSdk = createSdk(activeNetwork.chain);
      nextSdk = relayerSdk;
      setSdk(relayerSdk);
      // The SDK loads its FHE runtime lazily; fetching the network encryption
      // key up front surfaces relayer or WASM failures before the user acts.
      relayerSdk.relayer
        .fetchFheEncryptionKeyBytes()
        .then(() => {
          if (!cancelled) {
            setStatus("ready");
            recordInitialization("ok");
          }
        })
        .catch(failInitialization);
    }

    return () => {
      cancelled = true;
      nextSdk?.terminate();
    };
  }, [
    activeChainId,
    address,
    isConnected,
    publicClient,
    walletClient,
    refreshKey,
  ]);

  const refresh = useCallback(() => {
    setRefreshKey((value) => value + 1);
  }, []);

  const encryptIdentityAttributesForAttestation = useCallback<
    ConfidentialChainContextValue["encryptIdentityAttributesForAttestation"]
  >(
    async ({ attributes, registryAddress, userAddress }) => {
      assertConfidentialSdk(sdk, error);
      return await runMeasuredEncrypt(
        () =>
          sdk.encrypt({
            contractAddress: registryAddress,
            userAddress,
            values: [
              { type: "euint8", value: BigInt(attributes.birthYearOffset) },
              { type: "euint16", value: BigInt(attributes.countryCode) },
              { type: "euint8", value: BigInt(attributes.complianceLevel) },
              { type: "ebool", value: attributes.isBlacklisted },
            ],
          }),
        buildEncryptedIdentityAttributes
      );
    },
    [error, sdk]
  );

  const encryptTokenAmount = useCallback<
    ConfidentialChainContextValue["encryptTokenAmount"]
  >(
    async ({ amount, contractAddress, userAddress }) => {
      assertConfidentialSdk(sdk, error);
      return await runMeasuredEncrypt(
        () =>
          sdk.encrypt({
            contractAddress,
            userAddress,
            values: [{ type: "euint64", value: amount }],
          }),
        buildEncryptedTokenAmount
      );
    },
    [error, sdk]
  );

  const decryptIdentityAttributes = useCallback<
    ConfidentialChainContextValue["decryptIdentityAttributes"]
  >(
    async ({ attributeHandles, registryAddress }) => {
      assertConfidentialSdk(sdk, error);
      const clearValues = await sdk.decryption.decryptValues(
        buildIdentityAttributeDecryptHandles({
          attributeHandles,
          registryAddress,
        })
      );
      return deriveDecryptedIdentityAttributes({
        attributeHandles,
        clearValues,
      });
    },
    [error, sdk]
  );

  const value = useMemo<ConfidentialChainContextValue>(
    () => ({
      decryptIdentityAttributes,
      encryptIdentityAttributesForAttestation,
      encryptTokenAmount,
      error,
      isReady:
        Boolean(
          isConnected && address && publicClient && walletClient && sdk
        ) && status !== "error",
      refresh,
      status,
    }),
    [
      decryptIdentityAttributes,
      encryptIdentityAttributesForAttestation,
      encryptTokenAmount,
      error,
      isConnected,
      address,
      publicClient,
      walletClient,
      sdk,
      status,
      refresh,
    ]
  );

  return (
    <ConfidentialChainContext.Provider value={value}>
      {children}
    </ConfidentialChainContext.Provider>
  );
}

export function useConfidentialChain(): ConfidentialChainContextValue {
  const context = useContext(ConfidentialChainContext);
  if (!context) {
    throw new Error(
      "useConfidentialChain must be used within ConfidentialChainProvider"
    );
  }
  return context;
}
