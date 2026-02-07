"use client";

import { createAppKit } from "@reown/appkit/react";
import {
  ApiController,
  ChainController,
  ConnectorController,
  OptionsController,
} from "@reown/appkit-controllers";
/**
 * Web3 Provider with Reown AppKit
 *
 * Wraps the application with wagmi and AppKit providers.
 * Uses cookie-based storage for SSR compatibility.
 * Includes FhevmProvider for client-side FHE operations.
 */
import { type ReactNode, useEffect, useMemo } from "react";
import { cookieToInitialState, WagmiProvider } from "wagmi";

import { InMemoryStorageProvider } from "@/hooks/fhevm/use-in-memory-storage";
import {
  createWagmiAdapter,
  fhevmSepolia,
  getWagmiStorageKey,
  networks,
  projectId,
} from "@/lib/blockchain/wagmi/config";

import { FhevmProvider } from "./fhevm-provider";
import { SiweBridge } from "./siwe-bridge";

// App metadata for wallet connection
const metadata = {
  name: "Zentity",
  description: "Privacy-preserving identity verification",
  url:
    globalThis.window !== undefined
      ? globalThis.location.origin
      : "https://zentity.app",
  icons: ["/icon.png"],
};

let appkitInstance: ReturnType<typeof createAppKit> | null = null;
let appkitStorageKey: string | null = null;

interface Web3ProviderProps {
  children: ReactNode;
  cookies: string | null;
  walletScopeId: string | null;
}

const analyticsEnabled = process.env.NEXT_PUBLIC_APPKIT_ANALYTICS !== "false";

const defaultNetwork = networks[0] ?? fhevmSepolia;

function createAppKitInstance(
  wagmiAdapter: ReturnType<typeof createWagmiAdapter>
) {
  return createAppKit({
    adapters: [wagmiAdapter],
    projectId: projectId ?? "",
    networks,
    defaultNetwork,
    metadata,
    enableInjected: process.env.NEXT_PUBLIC_APPKIT_ENABLE_INJECTED !== "false",
    enableWalletConnect:
      process.env.NEXT_PUBLIC_APPKIT_ENABLE_WALLETCONNECT !== "false",
    enableEIP6963: process.env.NEXT_PUBLIC_APPKIT_ENABLE_EIP6963 !== "false",
    enableCoinbase: process.env.NEXT_PUBLIC_APPKIT_ENABLE_COINBASE !== "false",
    includeWalletIds: process.env.NEXT_PUBLIC_APPKIT_INCLUDE_WALLETS
      ? process.env.NEXT_PUBLIC_APPKIT_INCLUDE_WALLETS.split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : undefined,
    features: {
      analytics: analyticsEnabled,
      email: false,
      socials: false,
    },
    themeMode: "light",
  });
}

function ensureAppKitInitialized(
  wagmiAdapter: ReturnType<typeof createWagmiAdapter>,
  storageKey: string
) {
  if (globalThis.window === undefined || !projectId) {
    return;
  }

  if (
    appkitStorageKey &&
    appkitStorageKey !== storageKey &&
    globalThis.document
  ) {
    // biome-ignore lint/suspicious/noDocumentCookie: clearing stale appkit storage key requires cookie deletion
    document.cookie = `${appkitStorageKey}=; Max-Age=0; Path=/; SameSite=Lax; Secure`;
  }

  if (!appkitInstance || appkitStorageKey !== storageKey) {
    appkitInstance = createAppKitInstance(wagmiAdapter);
    appkitStorageKey = storageKey;
  }
}

if (globalThis.window !== undefined && projectId && !appkitInstance) {
  const bootstrapAdapter = createWagmiAdapter(null);
  const bootstrapStorageKey = getWagmiStorageKey(null);
  ensureAppKitInitialized(bootstrapAdapter, bootstrapStorageKey);
}

export function Web3Provider({
  children,
  cookies,
  walletScopeId,
}: Readonly<Web3ProviderProps>) {
  const wagmiAdapter = useMemo(
    () => createWagmiAdapter(walletScopeId),
    [walletScopeId]
  );
  const storageKey = useMemo(
    () => getWagmiStorageKey(walletScopeId),
    [walletScopeId]
  );
  ensureAppKitInitialized(wagmiAdapter, storageKey);

  useEffect(() => {
    if (!projectId) {
      return;
    }
    let isCancelled = false;
    const activeStorageKey = storageKey;
    const waitForInjectedProvider = async () => {
      if (globalThis.window === undefined) {
        return;
      }
      if ((globalThis as typeof globalThis & { ethereum?: unknown }).ethereum) {
        return;
      }

      await Promise.race([
        new Promise<void>((resolve) => {
          globalThis.addEventListener("ethereum#initialized", () => resolve(), {
            once: true,
          });
        }),
        new Promise<void>((resolve) => {
          setTimeout(resolve, 1500);
        }),
      ]);
    };

    (async () => {
      await waitForInjectedProvider();
      if (isCancelled) {
        return;
      }
      ensureAppKitInitialized(wagmiAdapter, activeStorageKey);

      const appkit = appkitInstance;
      if (!appkit) {
        return;
      }

      if (
        (process.env.NEXT_PUBLIC_APPKIT_DEBUG === "true" ||
          process.env.NODE_ENV === "development") &&
        globalThis.window !== undefined
      ) {
        (
          globalThis as typeof globalThis & {
            __appkit?: unknown;
            __appkitControllers?: unknown;
          }
        ).__appkit = appkit;
        (
          globalThis as typeof globalThis & {
            __appkit?: unknown;
            __appkitControllers?: unknown;
          }
        ).__appkitControllers = {
          ApiController,
          ChainController,
          ConnectorController,
          OptionsController,
        };
        ApiController.fetchWallets({ page: 1, entries: 50 }).catch(() => {
          // Wallet list is optional; provider continues without
        });
      }
    })().catch(() => {
      // Provider initialization handled by wagmi
    });

    return () => {
      isCancelled = true;
    };
  }, [storageKey, wagmiAdapter]);
  // Get initial state from cookies for SSR hydration
  const initialState = cookieToInitialState(wagmiAdapter.wagmiConfig, cookies);

  return (
    <WagmiProvider
      config={wagmiAdapter.wagmiConfig}
      initialState={initialState}
    >
      <InMemoryStorageProvider>
        <SiweBridge />
        <FhevmProvider>{children}</FhevmProvider>
      </InMemoryStorageProvider>
    </WagmiProvider>
  );
}
