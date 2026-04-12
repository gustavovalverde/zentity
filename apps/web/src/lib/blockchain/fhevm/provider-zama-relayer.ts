import type { FhevmProviderFactory } from "./provider-registry";
import type { FhevmInstance } from "./types";

const ZAMA_SDK_URL = "/fhevm/relayer-sdk-js.umd.js";

let zamaSdkLoadPromise: Promise<void> | null = null;

async function ensureZamaRelayerSdkLoaded(signal?: AbortSignal): Promise<void> {
  if (globalThis.window === undefined) {
    throw new Error("Zama relayer SDK can only be loaded in the browser");
  }

  if (globalThis.window.relayerSDK) {
    return;
  }

  const sdkUrl = ZAMA_SDK_URL;

  zamaSdkLoadPromise ??= new Promise<void>((resolve, reject) => {
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
      if (!globalThis.window.relayerSDK) {
        reject(new Error("Zama relayer SDK failed to initialize"));
        return;
      }
      resolve();
    };

    if (existing) {
      if (globalThis.window.relayerSDK) {
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

  const sdk = globalThis.window.relayerSDK;
  if (!sdk) {
    throw new Error("Zama relayer SDK failed to initialize");
  }

  await sdk.initSDK();

  const instance = (await sdk.createInstance({
    ...(sdk.SepoliaConfig as Record<string, unknown>),
    network: provider,
  })) as FhevmInstance;

  return instance;
};
