"use client";

import type { ReactNode } from "react";

import { createAppKit } from "@reown/appkit/react";
import { cookieToInitialState, WagmiProvider } from "wagmi";

import { InMemoryStorageProvider } from "@/hooks/fhevm/use-in-memory-storage";
import {
  fhevmSepolia,
  networks,
  projectId,
  wagmiAdapter,
} from "@/lib/blockchain/wagmi/config";

import { Eip712Bridge } from "./eip712-bridge";
import { FhevmProvider } from "./fhevm-provider";

const metadata = {
  name: "Zentity",
  description: "Privacy-preserving identity verification",
  url:
    globalThis.window !== undefined
      ? globalThis.location.origin
      : "https://zentity.app",
  icons: ["/icon.png"],
};

const analyticsEnabled = process.env.NEXT_PUBLIC_APPKIT_ANALYTICS !== "false";
const defaultNetwork = networks[0] ?? fhevmSepolia;

// Initialize AppKit once at module level — must use the same adapter as WagmiProvider
if (globalThis.window !== undefined && projectId) {
  createAppKit({
    adapters: [wagmiAdapter],
    projectId,
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
