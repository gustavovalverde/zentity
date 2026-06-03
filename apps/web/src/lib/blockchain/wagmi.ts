"use client";

/**
 * Wagmi configuration and client-side wallet hooks.
 *
 * - `wagmiAdapter` / `networks` / `confidentialSepolia` / `projectId`: Reown AppKit config
 * - `useDevFaucet`: Hardhat faucet hook for local dev
 *
 * Lives in `lib/blockchain/` because the adapter, network list, and faucet are
 * one client-side wallet boundary.
 */

import type { AppKitNetwork } from "@reown/appkit/networks";

import { hardhat as appKitHardhat, sepolia } from "@reown/appkit/networks";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { cookieStorage, createStorage } from "@wagmi/core";
import { useCallback, useState } from "react";
import { usePublicClient } from "wagmi";

import { env } from "@/env";
import {
  getConfidentialClientNetwork,
  HARDHAT_CONFIDENTIAL_CHAIN_ID,
  SEPOLIA_CONFIDENTIAL_CHAIN_ID,
} from "@/lib/blockchain/confidential/client-networks";

// ---------------------------------------------------------------------------
// Wagmi configuration
// ---------------------------------------------------------------------------

const CONFIDENTIAL_CHAIN_NETWORK_NAME = "Zama Confidential Sepolia";
const CONFIDENTIAL_CHAIN_EXPLORER_URL = "https://sepolia.etherscan.io";
const localHardhatNetwork = getConfidentialClientNetwork(
  HARDHAT_CONFIDENTIAL_CHAIN_ID
);
const localHardhatRpcUrl =
  localHardhatNetwork?.rpcUrl ?? env.NEXT_PUBLIC_LOCAL_RPC_URL;

export const confidentialSepolia = {
  id: SEPOLIA_CONFIDENTIAL_CHAIN_ID,
  name: CONFIDENTIAL_CHAIN_NETWORK_NAME,
  nativeCurrency: {
    name: "Sepolia Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [env.NEXT_PUBLIC_CONFIDENTIAL_CHAIN_RPC_URL],
    },
  },
  blockExplorers: {
    default: {
      name: "Etherscan",
      url: CONFIDENTIAL_CHAIN_EXPLORER_URL,
    },
  },
  testnet: true,
} as const satisfies AppKitNetwork;

const localHardhat = {
  ...appKitHardhat,
  rpcUrls: {
    ...appKitHardhat.rpcUrls,
    default: {
      http: [localHardhatRpcUrl],
    },
  },
} as const satisfies AppKitNetwork;

/**
 * Public demo project ID for localhost development.
 * This ID only works on localhost and should not be used in production.
 * @see https://github.com/reown-com/web-examples
 */
const LOCALHOST_DEMO_PROJECT_ID = "b56e18d47c72ab683b10814fe9495694";

function getProjectId(): string {
  if (env.NEXT_PUBLIC_PROJECT_ID) {
    return env.NEXT_PUBLIC_PROJECT_ID;
  }

  const isLocalhost = globalThis.window?.location.hostname === "localhost";
  if (isLocalhost || process.env.NODE_ENV === "development") {
    return LOCALHOST_DEMO_PROJECT_ID;
  }

  return "";
}

export const projectId = getProjectId();

function getEnabledNetworks(): [AppKitNetwork, ...AppKitNetwork[]] {
  const enabledNetworks: AppKitNetwork[] = [];

  if (
    process.env.NODE_ENV === "development" &&
    env.NEXT_PUBLIC_ENABLE_HARDHAT
  ) {
    enabledNetworks.push(localHardhat);
  }

  if (env.NEXT_PUBLIC_ENABLE_CONFIDENTIAL_CHAIN) {
    enabledNetworks.push(confidentialSepolia);
  }

  if (enabledNetworks.length === 0) {
    enabledNetworks.push(sepolia);
  }

  return enabledNetworks as [AppKitNetwork, ...AppKitNetwork[]];
}

export const networks = getEnabledNetworks();

/**
 * Single wagmi adapter shared by AppKit and WagmiProvider.
 * Connectors are registered by AppKit (EIP-6963 + WalletConnect + Coinbase)
 * via the createAppKit feature flags; declaring them here too registers the
 * same wallet twice and breaks the connect handshake (state lands on one
 * connector, hooks read the other).
 */
export const wagmiAdapter = new WagmiAdapter({
  storage: createStorage({
    storage: cookieStorage,
  }),
  ssr: true,
  projectId,
  networks,
});

// ---------------------------------------------------------------------------
// Dev faucet hook (Hardhat only)
// ---------------------------------------------------------------------------

const DEV_FAUCET_WEI = "0x8AC7230489E80000"; // 10 ETH

export function useDevFaucet(chainId?: number) {
  const publicClient = usePublicClient({ chainId });
  const [isFauceting, setIsFauceting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const isSupported =
    chainId === HARDHAT_CONFIDENTIAL_CHAIN_ID && Boolean(publicClient);

  const faucet = useCallback(
    async (address?: `0x${string}`) => {
      if (
        !(address && publicClient) ||
        chainId !== HARDHAT_CONFIDENTIAL_CHAIN_ID
      ) {
        return false;
      }

      setIsFauceting(true);
      setError(null);

      try {
        const requester = publicClient as unknown as {
          request: (args: {
            method: string;
            params?: unknown[];
          }) => Promise<unknown>;
        };
        await requester.request({
          method: "hardhat_setBalance",
          params: [address, DEV_FAUCET_WEI],
        });
        return true;
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Faucet failed"));
        return false;
      } finally {
        setIsFauceting(false);
      }
    },
    [publicClient, chainId]
  );

  return {
    faucet,
    isFauceting,
    error,
    isSupported,
  } as const;
}
