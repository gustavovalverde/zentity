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
 * Wraps the application with wagmi, AppKit, and tRPC providers.
 * Uses cookie-based storage for SSR compatibility.
 * Includes FhevmProvider for client-side FHE operations.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { type Config, cookieToInitialState, WagmiProvider } from "wagmi";

import { InMemoryStorageProvider } from "@/hooks/fhevm/use-in-memory-storage";
import { getTrpcClientConfig, trpcReact } from "@/lib/trpc/client";
import {
  createWagmiAdapter,
  fhevmSepolia,
  getWagmiStorageKey,
  networks,
  projectId,
} from "@/lib/wagmi/config";

import { FhevmProvider } from "./fhevm-provider";
import { SiweBridge } from "./siwe-bridge";

// App metadata for wallet connection
const metadata = {
  name: "Zentity",
  description: "Privacy-preserving identity verification",
  url:
    typeof window !== "undefined"
      ? window.location.origin
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

export function Web3Provider({
  children,
  cookies,
  walletScopeId,
}: Web3ProviderProps) {
  const wagmiAdapter = useMemo(
    () => createWagmiAdapter(walletScopeId),
    [walletScopeId]
  );
  const storageKey = useMemo(
    () => getWagmiStorageKey(walletScopeId),
    [walletScopeId]
  );

  useEffect(() => {
    if (!projectId) {
      return;
    }
    let isCancelled = false;
    const defaultNetwork = networks[0] ?? fhevmSepolia;
    const activeStorageKey = storageKey;
    // Disable AppKit analytics under cross-origin isolation (COEP) since
    // third-party analytics scripts may fail with restricted fetch policies.
    // Can be explicitly enabled via NEXT_PUBLIC_APPKIT_ANALYTICS=true.
    const analyticsEnabled =
      process.env.NEXT_PUBLIC_APPKIT_ANALYTICS === "true" ||
      (process.env.NEXT_PUBLIC_APPKIT_ANALYTICS !== "false" &&
        typeof window !== "undefined" &&
        !window.crossOriginIsolated);

    const initializeAppKit = () =>
      createAppKit({
        adapters: [wagmiAdapter],
        projectId,
        networks,
        defaultNetwork,
        metadata,
        enableInjected:
          process.env.NEXT_PUBLIC_APPKIT_ENABLE_INJECTED !== "false",
        enableWalletConnect:
          process.env.NEXT_PUBLIC_APPKIT_ENABLE_WALLETCONNECT !== "false",
        enableEIP6963:
          process.env.NEXT_PUBLIC_APPKIT_ENABLE_EIP6963 !== "false",
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

    const waitForInjectedProvider = async () => {
      if (typeof window === "undefined") {
        return;
      }
      if (window.ethereum) {
        return;
      }

      await Promise.race([
        new Promise<void>((resolve) => {
          window.addEventListener("ethereum#initialized", () => resolve(), {
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
      if (
        typeof window !== "undefined" &&
        appkitStorageKey &&
        appkitStorageKey !== activeStorageKey
      ) {
        // biome-ignore lint/suspicious/noDocumentCookie: intentional cleanup of wagmi cookie on account switch
        document.cookie = `${appkitStorageKey}=; Max-Age=0; Path=/`;
        window.location.reload();
        return;
      }

      if (!appkitInstance) {
        appkitInstance = initializeAppKit();
        appkitStorageKey = activeStorageKey;
      }

      const appkit = appkitInstance;

      if (
        (process.env.NEXT_PUBLIC_APPKIT_DEBUG === "true" ||
          process.env.NODE_ENV === "development") &&
        typeof window !== "undefined"
      ) {
        (
          window as typeof window & {
            __appkit?: unknown;
            __appkitControllers?: unknown;
          }
        ).__appkit = appkit;
        (
          window as typeof window & {
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
  // Create QueryClient once per component instance (shared by wagmi and tRPC)
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // 1 minute
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  // Create tRPC client once per component instance
  const [trpcClient] = useState(() =>
    trpcReact.createClient(getTrpcClientConfig())
  );

  // Get initial state from cookies for SSR hydration
  const initialState = cookieToInitialState(
    wagmiAdapter.wagmiConfig as Config,
    cookies
  );

  return (
    <trpcReact.Provider client={trpcClient} queryClient={queryClient}>
      <WagmiProvider
        config={wagmiAdapter.wagmiConfig as Config}
        initialState={initialState}
      >
        <QueryClientProvider client={queryClient}>
          <InMemoryStorageProvider>
            <SiweBridge />
            <FhevmProvider>{children}</FhevmProvider>
          </InMemoryStorageProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </trpcReact.Provider>
  );
}
