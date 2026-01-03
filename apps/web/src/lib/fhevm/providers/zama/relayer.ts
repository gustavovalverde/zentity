import type { FhevmInstance } from "../../types";
import type { FhevmProviderFactory } from "../types";

const DEFAULT_ZAMA_SDK_URL = "/fhevm/relayer-sdk-js.umd.js";

let zamaSdkLoadPromise: Promise<void> | null = null;

async function ensureZamaRelayerSdkLoaded(signal?: AbortSignal): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("Zama relayer SDK can only be loaded in the browser");
  }

  if (window.relayerSDK) {
    return;
  }

  if (!zamaSdkLoadPromise) {
    const sdkUrl =
      process.env.NEXT_PUBLIC_FHEVM_ZAMA_SDK_URL || DEFAULT_ZAMA_SDK_URL;

    zamaSdkLoadPromise = new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error("Zama relayer SDK load aborted"));
        return;
      }

      const abortHandler = () => {
        reject(new Error("Zama relayer SDK load aborted"));
      };

      if (signal) {
        signal.addEventListener("abort", abortHandler, { once: true });
      }

      const existing = document.querySelector<HTMLScriptElement>(
        'script[data-fhevm-sdk="zama"]'
      );

      const handleLoad = () => {
        if (signal) {
          signal.removeEventListener("abort", abortHandler);
        }
        if (!window.relayerSDK) {
          reject(new Error("Zama relayer SDK failed to initialize"));
          return;
        }
        resolve();
      };

      if (existing) {
        if (window.relayerSDK) {
          resolve();
          return;
        }
        existing.addEventListener("load", handleLoad, { once: true });
        existing.addEventListener(
          "error",
          () => reject(new Error("Failed to load Zama relayer SDK")),
          { once: true }
        );
        return;
      }

      const script = document.createElement("script");
      script.src = sdkUrl;
      script.async = true;
      script.defer = true;
      script.dataset.fhevmSdk = "zama";
      script.addEventListener("load", handleLoad, { once: true });
      script.addEventListener(
        "error",
        () => reject(new Error("Failed to load Zama relayer SDK")),
        { once: true }
      );
      document.head.appendChild(script);
    }).catch((error) => {
      zamaSdkLoadPromise = null;
      throw error;
    });
  }

  if (signal?.aborted) {
    throw new Error("Zama relayer SDK load aborted");
  }

  await zamaSdkLoadPromise;
}

export const createZamaRelayerInstance: FhevmProviderFactory = async ({
  provider,
  signal,
}) => {
  await ensureZamaRelayerSdkLoaded(signal);

  const sdk = window.relayerSDK;
  if (!sdk) {
    throw new Error("Zama relayer SDK failed to initialize");
  }

  await sdk.initSDK();

  const relayerUrl = process.env.NEXT_PUBLIC_FHEVM_RELAYER_URL?.trim();
  const chainId = Number(process.env.NEXT_PUBLIC_FHEVM_CHAIN_ID || "");
  const gatewayChainId = Number(
    process.env.NEXT_PUBLIC_FHEVM_GATEWAY_CHAIN_ID || ""
  );
  const aclContractAddress = process.env.NEXT_PUBLIC_FHEVM_ACL_CONTRACT_ADDRESS;
  const kmsContractAddress = process.env.NEXT_PUBLIC_FHEVM_KMS_CONTRACT_ADDRESS;
  const inputVerifierContractAddress =
    process.env.NEXT_PUBLIC_FHEVM_INPUT_VERIFIER_CONTRACT_ADDRESS;
  const verifyingContractAddressDecryption =
    process.env.NEXT_PUBLIC_FHEVM_DECRYPTION_ADDRESS;
  const verifyingContractAddressInputVerification =
    process.env.NEXT_PUBLIC_FHEVM_INPUT_VERIFICATION_ADDRESS;

  // Select config based on chain ID (mainnet = 1, otherwise Sepolia)
  const baseConfig = chainId === 1 ? sdk.MainnetConfig : sdk.SepoliaConfig;

  const instance = (await sdk.createInstance({
    ...(baseConfig as Record<string, unknown>),
    ...(Number.isFinite(gatewayChainId) && gatewayChainId > 0
      ? { gatewayChainId }
      : {}),
    ...(aclContractAddress ? { aclContractAddress } : {}),
    ...(kmsContractAddress ? { kmsContractAddress } : {}),
    ...(inputVerifierContractAddress ? { inputVerifierContractAddress } : {}),
    ...(verifyingContractAddressDecryption
      ? { verifyingContractAddressDecryption }
      : {}),
    ...(verifyingContractAddressInputVerification
      ? { verifyingContractAddressInputVerification }
      : {}),
    ...(relayerUrl ? { relayerUrl } : {}),
    network: provider as unknown,
  })) as FhevmInstance;

  return instance;
};
