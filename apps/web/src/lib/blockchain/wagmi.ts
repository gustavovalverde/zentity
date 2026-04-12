"use client";

/**
 * Wagmi configuration and client-side wallet hooks.
 *
 * - `wagmiAdapter` / `networks` / `fhevmSepolia` / `projectId`: Reown AppKit config
 * - `useDevFaucet`: Hardhat faucet hook for local dev
 * - `useEthersSigner`: bridges wagmi to ethers v6 JsonRpcSigner (for FHEVM EIP-712)
 *
 * Lives in `lib/blockchain/` because all three concerns are tightly coupled to
 * the wagmi adapter and targeted networks; splitting them into separate files
 * required consumers to track three import paths for one mental model.
 */

import type { AppKitNetwork } from "@reown/appkit/networks";

import { hardhat, sepolia } from "@reown/appkit/networks";
import { useAppKitAccount } from "@reown/appkit/react";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { cookieStorage, createStorage, injected } from "@wagmi/core";
import { BrowserProvider, type Eip1193Provider, type Signer } from "ethers";
import { useCallback, useEffect, useState } from "react";
import { usePublicClient } from "wagmi";

import { env } from "@/env";

// ---------------------------------------------------------------------------
// Wagmi configuration
// ---------------------------------------------------------------------------

const FHEVM_CHAIN_ID = 11_155_111;
const FHEVM_NETWORK_NAME = "fhEVM (Sepolia)";
const FHEVM_EXPLORER_URL = "https://sepolia.etherscan.io";

export const fhevmSepolia = {
  id: FHEVM_CHAIN_ID,
  name: FHEVM_NETWORK_NAME,
  nativeCurrency: {
    name: "Sepolia Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [env.NEXT_PUBLIC_FHEVM_RPC_URL],
    },
  },
  blockExplorers: {
    default: {
      name: "Etherscan",
      url: FHEVM_EXPLORER_URL,
    },
  },
  testnet: true,
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
    enabledNetworks.push(hardhat);
  }

  if (env.NEXT_PUBLIC_ENABLE_FHEVM) {
    enabledNetworks.push(fhevmSepolia);
  }

  if (enabledNetworks.length === 0) {
    enabledNetworks.push(sepolia);
  }

  return enabledNetworks as [AppKitNetwork, ...AppKitNetwork[]];
}

export const networks = getEnabledNetworks();

/**
 * Single wagmi adapter shared by AppKit and WagmiProvider.
 * Wallet connections are browser-level — no per-user scoping needed.
 */
export const wagmiAdapter = new WagmiAdapter({
  storage: createStorage({
    storage: cookieStorage,
  }),
  ssr: true,
  projectId,
  networks,
  connectors: [injected({ shimDisconnect: true })],
});

// ---------------------------------------------------------------------------
// Dev faucet hook (Hardhat only)
// ---------------------------------------------------------------------------

const HARDHAT_CHAIN_ID = 31_337;
const DEV_FAUCET_WEI = "0x8AC7230489E80000"; // 10 ETH

export function useDevFaucet(chainId?: number) {
  const publicClient = usePublicClient({ chainId });
  const [isFauceting, setIsFauceting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const isSupported = chainId === HARDHAT_CHAIN_ID && Boolean(publicClient);

  const faucet = useCallback(
    async (address?: `0x${string}`) => {
      if (!(address && publicClient) || chainId !== HARDHAT_CHAIN_ID) {
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

// ---------------------------------------------------------------------------
// Ethers signer hook (bridges wagmi → ethers v6)
// ---------------------------------------------------------------------------

/**
 * Bridges wagmi's wallet client to an ethers v6 JsonRpcSigner.
 * Needed for the FHEVM SDK which requires ethers signers for EIP-712 signatures.
 */
export function useEthersSigner(): Signer | undefined {
  const { address, isConnected } = useAppKitAccount();
  const [signer, setSigner] = useState<Signer | undefined>(undefined);

  useEffect(() => {
    async function getSigner() {
      if (!(isConnected && address) || globalThis.window === undefined) {
        setSigner(undefined);
        return;
      }

      const ethereum = globalThis.window.ethereum as
        | Eip1193Provider
        | undefined;
      if (!ethereum) {
        setSigner(undefined);
        return;
      }

      try {
        const provider = new BrowserProvider(ethereum);
        const ethSigner = await provider.getSigner(address);
        setSigner(ethSigner);
      } catch {
        setSigner(undefined);
      }
    }

    getSigner().catch(() => {
      // Error already caught in try-catch above
    });
  }, [address, isConnected]);

  return signer;
}
