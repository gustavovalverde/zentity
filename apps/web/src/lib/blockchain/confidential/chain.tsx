"use client";

import type {
  EncryptResult,
  RelayerSDKStatus,
  ZamaSDKEvent,
  ZamaSDKEventType,
} from "@zama-fhe/sdk";
import type { ReactNode } from "react";
import type { EIP1193Provider } from "viem";

import { useAppKitAccount } from "@reown/appkit/react";
import {
  IndexedDBStorage,
  MemoryStorage,
  RelayerWeb,
  ZamaSDK,
} from "@zama-fhe/sdk";
import { RelayerCleartext } from "@zama-fhe/sdk/cleartext";
import { ViemSigner } from "@zama-fhe/sdk/viem";
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
  buildConfidentialRelayerTransports,
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
const CONFIDENTIAL_KEYPAIR_TTL_SECONDS = 30 * 86_400;
const CONFIDENTIAL_ARTIFACT_CACHE_TTL_SECONDS = 86_400;
const confidentialLogger =
  process.env.NODE_ENV === "development" ? console : undefined;

type ConfidentialChainStatus = RelayerSDKStatus | "not_connected";

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
      value: encryptedInput.inputProof.byteLength,
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

    let relayer: RelayerCleartext | RelayerWeb;
    if (activeNetwork.mode === "cleartext") {
      relayer = new RelayerCleartext(activeNetwork.cleartextConfig);
      setStatus("ready");
      setError(null);
    } else {
      const webRelayer = new RelayerWeb({
        getChainId: async () => activeNetwork.chainId,
        transports: buildConfidentialRelayerTransports(),
        logger: confidentialLogger,
        fheArtifactStorage: new IndexedDBStorage(
          "ZentityConfidentialArtifacts",
          1,
          "artifacts"
        ),
        fheArtifactCacheTTL: CONFIDENTIAL_ARTIFACT_CACHE_TTL_SECONDS,
        onStatusChange: (nextStatus, nextError) => {
          setStatus(nextStatus);
          setError(nextError ?? null);
          if (nextStatus === "ready" || nextStatus === "error") {
            recordClientMetric({
              name: "client.confidential.init.duration",
              value: performance.now() - initializationStartedAt,
              attributes: {
                result: nextStatus === "ready" ? "ok" : "error",
                chain_id: String(activeChainId),
                trigger: initializationTrigger,
              },
            });
          }
        },
      });
      relayer = webRelayer;
      setStatus(webRelayer.status);
      setError(webRelayer.initError ?? null);
    }
    const signer = new ViemSigner({
      publicClient,
      walletClient,
      ethereum: getBrowserEthereumProvider(),
    });
    const nextSdk = new ZamaSDK({
      relayer,
      signer,
      storage: new IndexedDBStorage(
        "ZentityConfidentialCredentials",
        1,
        "credentials"
      ),
      sessionStorage: new MemoryStorage(),
      keypairTTL: CONFIDENTIAL_KEYPAIR_TTL_SECONDS,
      sessionTTL: CONFIDENTIAL_SESSION_TTL_SECONDS,
      onEvent: recordSdkEvent,
    });

    setSdk(nextSdk);

    return () => {
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
          sdk.relayer.encrypt({
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
          sdk.relayer.encrypt({
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
        const clearValues = await sdk.userDecrypt(
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
