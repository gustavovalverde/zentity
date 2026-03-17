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

const defaultNetwork = networks[0] ?? fhevmSepolia;

// Initialize AppKit once at module level — must use the same adapter as WagmiProvider
if (globalThis.window !== undefined && projectId) {
  createAppKit({
    adapters: [
      Object.fromEntries(
        Object.entries(wagmiAdapter).filter(([, v]) => v !== undefined)
      ),
    ],
    projectId,
    networks,
    defaultNetwork,
    metadata,
    enableInjected: true,
    enableWalletConnect: true,
    enableEIP6963: true,
    enableCoinbase: true,
    features: {
      analytics: true,
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
