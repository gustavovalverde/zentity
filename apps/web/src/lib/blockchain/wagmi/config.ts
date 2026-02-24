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

import { env } from "@/env";

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

/**
 * Get WalletConnect/Reown project ID from environment.
 * Falls back to demo ID on localhost for easier development.
 */
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

/**
 * Determine which networks to enable based on environment.
 */
function getEnabledNetworks(): [AppKitNetwork, ...AppKitNetwork[]] {
  const networks: AppKitNetwork[] = [];

  if (
    process.env.NODE_ENV === "development" &&
    env.NEXT_PUBLIC_ENABLE_HARDHAT
  ) {
    networks.push(hardhat);
  }

  if (env.NEXT_PUBLIC_ENABLE_FHEVM) {
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
