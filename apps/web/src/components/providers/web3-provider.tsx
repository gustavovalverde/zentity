"use client";

import type { ReactNode } from "react";

import { createAppKit } from "@reown/appkit/react";
import { cookieToInitialState, WagmiProvider } from "wagmi";

import { env } from "@/env";
import { InMemoryStorageProvider } from "@/lib/blockchain/fhevm/use-in-memory-storage";
import {
  fhevmSepolia,
  networks,
  projectId,
  wagmiAdapter,
} from "@/lib/blockchain/wagmi";

import { Eip712Bridge } from "./eip712-bridge";
import { FhevmProvider } from "./fhevm-provider";

const metadata = {
  name: "Zentity",
  description: "Privacy-preserving identity verification",
  url:
    globalThis.window === undefined
      ? "https://zentity.app"
      : globalThis.location.origin,
  icons: ["/icon.png"],
};

const defaultNetwork = networks[0] ?? fhevmSepolia;

// Initialize AppKit once at module level — must use the same adapter as WagmiProvider
if (globalThis.window !== undefined && projectId) {
  createAppKit({
    adapters: [wagmiAdapter],
    projectId,
    networks,
    defaultNetwork,
    metadata,
    enableInjected: env.NEXT_PUBLIC_APPKIT_ENABLE_INJECTED,
    enableWalletConnect: env.NEXT_PUBLIC_APPKIT_ENABLE_WALLETCONNECT,
    enableEIP6963: env.NEXT_PUBLIC_APPKIT_ENABLE_EIP6963,
    enableCoinbase: env.NEXT_PUBLIC_APPKIT_ENABLE_COINBASE,
    features: {
      analytics: env.NEXT_PUBLIC_APPKIT_ANALYTICS,
      email: false,
      socials: false,
    },
    themeMode: "light",
  });
}

interface Web3ProviderProps {
  children: ReactNode;
  cookies: string | null;
}

export function Web3Provider({
  children,
  cookies,
}: Readonly<Web3ProviderProps>) {
  const initialState = cookieToInitialState(wagmiAdapter.wagmiConfig, cookies);

  return (
    <WagmiProvider
      config={wagmiAdapter.wagmiConfig}
      initialState={initialState}
    >
      <InMemoryStorageProvider>
        <Eip712Bridge />
        <FhevmProvider>{children}</FhevmProvider>
      </InMemoryStorageProvider>
    </WagmiProvider>
  );
}
