/**
 * Network Configuration
 *
 * Defines supported blockchain networks for identity attestation.
 * Networks can be enabled/disabled via environment variables.
 *
 * To add a new network:
 * 1. Add entry to NETWORKS with unique id
 * 2. Set type to "fhevm" (encrypted) or "evm" (standard)
 * 3. Configure contracts addresses via env vars
 * 4. Enable via NEXT_PUBLIC_ENABLE_{NETWORK}=true
 *
 * Demo Mode:
 * Set NEXT_PUBLIC_ATTESTATION_DEMO=true to enable demo networks
 * without requiring deployed contracts. Useful for UI development.
 */
import "server-only";

export type NetworkType = "fhevm" | "evm";

export type NetworkFeature = "encrypted" | "basic";

export interface NetworkConfig {
  /** Unique identifier (e.g., "fhevm_sepolia", "hardhat") */
  id: string;
  /** Display name for UI */
  name: string;
  /** EVM chain ID */
  chainId: number;
  /** RPC endpoint URL */
  rpcUrl: string;
  /** Registrar private key for this network (server-side only) */
  registrarPrivateKey?: string;
  /** Provider type - determines which provider class to use */
  type: NetworkType;
  /** Provider implementation ID for FHEVM networks (e.g., "zama", "mock") */
  providerId?: string;
  /** Network capabilities */
  features: NetworkFeature[];
  /** Deployed contract addresses */
  contracts: {
    identityRegistry: string;
    complianceRules?: string;
    compliantERC20?: string;
  };
  /** Block explorer URL (for tx links) */
  explorer?: string;
  /** Whether this network is currently enabled */
  enabled: boolean;
}

/**
 * Registry of all supported networks.
 *
 * Networks are enabled via environment variables:
 * - NEXT_PUBLIC_ENABLE_FHEVM (default: true)
 * - NEXT_PUBLIC_ENABLE_HARDHAT (development only)
 */
const FHEVM_NETWORK_ID =
  process.env.FHEVM_NETWORK_ID ||
  process.env.NEXT_PUBLIC_FHEVM_NETWORK_ID ||
  "fhevm_sepolia";
const FHEVM_CHAIN_ID = Number(
  process.env.FHEVM_CHAIN_ID ||
    process.env.NEXT_PUBLIC_FHEVM_CHAIN_ID ||
    11155111,
);
const FHEVM_NETWORK_NAME =
  process.env.FHEVM_NETWORK_NAME ||
  process.env.NEXT_PUBLIC_FHEVM_NETWORK_NAME ||
  "fhEVM (Sepolia)";
const FHEVM_EXPLORER_URL =
  process.env.FHEVM_EXPLORER_URL ||
  process.env.NEXT_PUBLIC_FHEVM_EXPLORER_URL ||
  "https://sepolia.etherscan.io";
const FHEVM_PROVIDER_ID =
  process.env.FHEVM_PROVIDER_ID ||
  process.env.NEXT_PUBLIC_FHEVM_PROVIDER_ID ||
  "zama";

const NETWORKS: Record<string, NetworkConfig> = {
  [FHEVM_NETWORK_ID]: {
    id: FHEVM_NETWORK_ID,
    name: FHEVM_NETWORK_NAME,
    chainId: FHEVM_CHAIN_ID,
    rpcUrl:
      process.env.FHEVM_RPC_URL ||
      process.env.NEXT_PUBLIC_FHEVM_RPC_URL ||
      "https://ethereum-sepolia-rpc.publicnode.com",
    registrarPrivateKey:
      process.env.FHEVM_REGISTRAR_PRIVATE_KEY ||
      process.env.REGISTRAR_PRIVATE_KEY ||
      "",
    type: "fhevm",
    providerId: FHEVM_PROVIDER_ID,
    features: ["encrypted"],
    contracts: {
      identityRegistry: process.env.FHEVM_IDENTITY_REGISTRY || "",
      complianceRules: process.env.FHEVM_COMPLIANCE_RULES || "",
      compliantERC20: process.env.FHEVM_COMPLIANT_ERC20 || "",
    },
    explorer: FHEVM_EXPLORER_URL,
    enabled: process.env.NEXT_PUBLIC_ENABLE_FHEVM !== "false",
  },
  hardhat: {
    id: "hardhat",
    name: "Local (Hardhat)",
    chainId: 31337,
    rpcUrl: process.env.LOCAL_RPC_URL || "http://127.0.0.1:8545",
    registrarPrivateKey:
      process.env.LOCAL_REGISTRAR_PRIVATE_KEY ||
      process.env.REGISTRAR_PRIVATE_KEY ||
      "",
    type: "fhevm",
    providerId: "mock",
    features: ["encrypted"],
    contracts: {
      identityRegistry: process.env.LOCAL_IDENTITY_REGISTRY || "",
      complianceRules: process.env.LOCAL_COMPLIANCE_RULES || "",
      compliantERC20: process.env.LOCAL_COMPLIANT_ERC20 || "",
    },
    enabled:
      process.env.NODE_ENV === "development" &&
      process.env.NEXT_PUBLIC_ENABLE_HARDHAT === "true",
  },
  // Future networks can be added here:
  // ethereum_sepolia: {
  //   id: "ethereum_sepolia",
  //   name: "Ethereum Sepolia",
  //   chainId: 11155111,
  //   rpcUrl: process.env.ETH_SEPOLIA_RPC_URL || "",
  //   type: "evm",
  //   features: ["basic"],
  //   contracts: { identityRegistry: process.env.ETH_SEPOLIA_REGISTRY || "" },
  //   explorer: "https://sepolia.etherscan.io",
  //   enabled: process.env.NEXT_PUBLIC_ENABLE_ETH_SEPOLIA === "true",
  // },
};

/**
 * Demo networks for UI development without deployed contracts.
 * These are only shown when NEXT_PUBLIC_ATTESTATION_DEMO=true.
 */
const DEMO_NETWORKS: NetworkConfig[] = [
  {
    id: "demo_fhevm",
    name: "fhEVM Demo",
    chainId: FHEVM_CHAIN_ID,
    rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    type: "fhevm",
    providerId: FHEVM_PROVIDER_ID,
    features: ["encrypted"],
    contracts: {
      identityRegistry: "0xDEMO000000000000000000000000000000000001",
    },
    explorer: "https://sepolia.etherscan.io",
    enabled: true,
  },
];

/**
 * Check if demo mode is enabled.
 * Demo mode shows mock networks for UI development.
 */
export function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_ATTESTATION_DEMO === "true";
}

/**
 * Get all networks that are enabled and have contracts configured.
 * In demo mode, returns demo networks instead.
 */
export function getEnabledNetworks(): NetworkConfig[] {
  if (isDemoMode()) {
    return DEMO_NETWORKS;
  }

  return Object.values(NETWORKS).filter(
    (network) => network.enabled && network.contracts.identityRegistry,
  );
}

/**
 * Get a specific network by ID.
 */
export function getNetworkById(id: string): NetworkConfig | undefined {
  return NETWORKS[id];
}

/**
 * Check if a network is enabled and configured.
 */
export function isNetworkAvailable(id: string): boolean {
  const network = getNetworkById(id);
  return Boolean(network?.enabled && network.contracts.identityRegistry);
}

/**
 * Get the explorer URL for a transaction on a specific network.
 */
export function getExplorerTxUrl(
  networkId: string,
  txHash: string,
): string | undefined {
  const network = getNetworkById(networkId);
  if (!network?.explorer) return undefined;
  return `${network.explorer}/tx/${txHash}`;
}
