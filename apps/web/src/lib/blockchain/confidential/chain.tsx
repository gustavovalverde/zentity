"use client";

import type {
  EncryptResult,
  ZamaSDKEvent,
  ZamaSDKEventType,
} from "@zama-fhe/sdk";
import type { ReactNode } from "react";
import type { EIP1193Provider } from "viem";

import { useAppKitAccount } from "@reown/appkit/react";
import {
  cleartext,
  IndexedDBStorage,
  MemoryStorage,
  ZamaSDK,
} from "@zama-fhe/sdk";
import { createConfig } from "@zama-fhe/sdk/viem";
import { web } from "@zama-fhe/sdk/web";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useChainId, usePublicClient, useWalletClient } from "wagmi";

import { recordClientMetric } from "@/lib/observability/client-metrics";

import {
  getConfidentialClientNetwork,
  HARDHAT_CONFIDENTIAL_CHAIN_ID,
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

function assertConfidentialSdk(sdk: ZamaSDK | null): asserts sdk is ZamaSDK {
  if (!sdk) {
    throw new Error(
      "Confidential chain client is not ready. Check wallet connection and network."
    );
  }
}

function buildLocalIdentityCacheKey(input: {
  chainId: number;
  registryAddress: `0x${string}`;
  userAddress: `0x${string}`;
}) {
  return `${input.chainId}:${input.registryAddress.toLowerCase()}:${input.userAddress.toLowerCase()}`;
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
  const localIdentityValuesRef = useRef(
    new Map<string, IdentityAttributesForAttestation>()
  );

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

    const { chain } = activeNetwork;
    const nextSdk = new ZamaSDK(
      createConfig({
        chains: [chain],
        publicClient,
        walletClient,
        ethereum: getBrowserEthereumProvider(),
        relayers: {
          [chain.id]: activeNetwork.mode === "cleartext" ? cleartext() : web(),
        },
        storage: new IndexedDBStorage(
          "ZentityConfidentialCredentials",
          1,
          "credentials"
        ),
        permitStorage: new MemoryStorage(),
        transportKeyPairTTL: CONFIDENTIAL_TRANSPORT_KEY_PAIR_TTL_SECONDS,
        permitTTL: CONFIDENTIAL_PERMIT_TTL_DAYS,
        onEvent: recordSdkEvent,
        logger: confidentialLogger,
      })
    );

    let cancelled = false;
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

    if (activeNetwork.mode === "cleartext") {
      setStatus("ready");
      setError(null);
    } else {
      // The SDK loads its FHE runtime lazily; fetching the network encryption
      // key up front surfaces relayer or WASM failures before the user acts.
      setStatus("initializing");
      setError(null);
      nextSdk.relayer
        .fetchFheEncryptionKeyBytes()
        .then(() => {
          if (!cancelled) {
            setStatus("ready");
            recordInitialization("ok");
          }
        })
        .catch((initError: unknown) => {
          if (!cancelled) {
            setStatus("error");
            setError(
              initError instanceof Error
                ? initError
                : new Error(String(initError))
            );
            recordInitialization("error");
          }
        });
    }

    setSdk(nextSdk);

    return () => {
      cancelled = true;
      nextSdk.terminate();
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
      assertConfidentialSdk(sdk);
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
        (encryptedInput) => {
          if (activeChainId === HARDHAT_CONFIDENTIAL_CHAIN_ID) {
            localIdentityValuesRef.current.set(
              buildLocalIdentityCacheKey({
                chainId: activeChainId,
                registryAddress,
                userAddress,
              }),
              attributes
            );
          }
          return buildEncryptedIdentityAttributes(encryptedInput);
        }
      );
    },
    [activeChainId, sdk]
  );

  const encryptTokenAmount = useCallback<
    ConfidentialChainContextValue["encryptTokenAmount"]
  >(
    async ({ amount, contractAddress, userAddress }) => {
      assertConfidentialSdk(sdk);
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
    [sdk]
  );

  const decryptIdentityAttributes = useCallback<
    ConfidentialChainContextValue["decryptIdentityAttributes"]
  >(
    async ({ attributeHandles, registryAddress }) => {
      assertConfidentialSdk(sdk);
      try {
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
      } catch (decryptError) {
        if (activeChainId === HARDHAT_CONFIDENTIAL_CHAIN_ID && address) {
          const cachedValues = localIdentityValuesRef.current.get(
            buildLocalIdentityCacheKey({
              chainId: activeChainId,
              registryAddress,
              userAddress: address as `0x${string}`,
            })
          );
          if (cachedValues) {
            return cachedValues;
          }
        }
        throw decryptError;
      }
    },
    [activeChainId, address, sdk]
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
