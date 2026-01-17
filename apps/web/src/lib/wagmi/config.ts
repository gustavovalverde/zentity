/**
 * Wagmi Configuration with Reown AppKit
 *
 * Sets up Web3 wallet connectivity for Zentity using Reown AppKit.
 * Supports multiple networks including fhEVM Sepolia and local Hardhat.
 */

import type { AppKitNetwork } from "@reown/appkit/networks";

import { hardhat, sepolia } from "@reown/appkit/networks";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { cookieStorage, createStorage, injected } from "@wagmi/core";

/**
 * fhEVM Sepolia network configuration.
 * Uses the same chainId as Sepolia (11155111) with a public Sepolia RPC.
 */
const FHEVM_CHAIN_ID = Number(
  process.env.NEXT_PUBLIC_FHEVM_CHAIN_ID || 11_155_111
);
const FHEVM_NETWORK_NAME =
  process.env.NEXT_PUBLIC_FHEVM_NETWORK_NAME || "fhEVM (Sepolia)";
const FHEVM_EXPLORER_URL =
  process.env.NEXT_PUBLIC_FHEVM_EXPLORER_URL || "https://sepolia.etherscan.io";

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
      http: [
        process.env.NEXT_PUBLIC_FHEVM_RPC_URL ||
          "https://ethereum-sepolia-rpc.publicnode.com",
      ],
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

/**
 * Get WalletConnect/Reown project ID from environment.
 * Falls back to demo ID on localhost for easier development.
 */
function getProjectId(): string {
  const envProjectId = process.env.NEXT_PUBLIC_PROJECT_ID;

  if (envProjectId) {
    return envProjectId;
  }

  // Use demo project ID for localhost development (client-side check)
  const isLocalhost = globalThis.window?.location.hostname === "localhost";

  if (isLocalhost || process.env.NODE_ENV === "development") {
    return LOCALHOST_DEMO_PROJECT_ID;
  }

  // Production without project ID - wallet connection won't work
  return "";
}

export const projectId = getProjectId();

/**
 * Determine which networks to enable based on environment.
 */
function getEnabledNetworks(): [AppKitNetwork, ...AppKitNetwork[]] {
  const networks: AppKitNetwork[] = [];

  const hardhatEnabled =
    process.env.NODE_ENV === "development" &&
    process.env.NEXT_PUBLIC_ENABLE_HARDHAT === "true";

  if (hardhatEnabled) {
    networks.push(hardhat);
  }

  // Always include fhEVM network unless explicitly disabled
  if (process.env.NEXT_PUBLIC_ENABLE_FHEVM !== "false") {
    networks.push(fhevmSepolia);
  }

  // Fallback to Sepolia if no networks enabled
  if (networks.length === 0) {
    networks.push(sepolia);
  }

  return networks as [AppKitNetwork, ...AppKitNetwork[]];
}

export const networks = getEnabledNetworks();

/**
 * Wagmi Adapter for Reown AppKit.
 * Uses cookie storage for SSR compatibility.
 */
export function getWagmiStorageKey(scope?: string | null) {
  const safeScope = scope?.trim() ? scope : "anon";
  return `wagmi.${safeScope}`;
}

export function createWagmiAdapter(storageScope?: string | null) {
  const injectedConnector =
    globalThis.window === undefined ? null : injected({ shimDisconnect: true });

  return new WagmiAdapter({
    storage: createStorage({
      storage: cookieStorage,
      key: getWagmiStorageKey(storageScope),
    }),
    ssr: true,
    projectId,
    networks,
    connectors: injectedConnector ? [injectedConnector] : undefined,
  });
}
