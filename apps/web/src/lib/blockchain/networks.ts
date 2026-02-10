/**
 * Network Configuration
 *
 * Defines supported blockchain networks for identity attestation.
 * Networks can be enabled/disabled via environment variables.
 *
 * To add a new network:
 * 1. Add entry to NETWORKS with unique id
 * 2. Set type to "fhevm" (encrypted)
 * 3. Configure contracts addresses via env vars
 * 4. Enable via NEXT_PUBLIC_ENABLE_{NETWORK}=true
 */
import "server-only";

import { resolveContractAddresses } from "@zentity/fhevm-contracts";

export type NetworkType = "fhevm";

export type NetworkFeature = "encrypted" | "basic";

type ContractName = "IdentityRegistry" | "ComplianceRules" | "CompliantERC20";

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
    11_155_111
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

function toOverrides(values: Partial<Record<ContractName, string>>) {
  const overrides = Object.fromEntries(
    Object.entries(values).filter(([, value]) => Boolean(value?.trim()))
  ) as Partial<Record<ContractName, string>>;

  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

function resolveNetworkContracts(
  chainId: number,
  prefer: "hardhat" | "localhost" | "sepolia",
  overrides?: Partial<Record<ContractName, string>>
) {
  const contracts = overrides
    ? resolveContractAddresses(chainId, { prefer, overrides })
    : resolveContractAddresses(chainId, { prefer });

  return {
    identityRegistry: contracts.IdentityRegistry,
    complianceRules: contracts.ComplianceRules,
    compliantERC20: contracts.CompliantERC20,
  };
}

const FHEVM_ENABLED = process.env.NEXT_PUBLIC_ENABLE_FHEVM !== "false";
const HARDHAT_ENABLED =
  process.env.NODE_ENV === "development" &&
  process.env.NEXT_PUBLIC_ENABLE_HARDHAT === "true";

const FHEVM_CONTRACTS = FHEVM_ENABLED
  ? resolveNetworkContracts(
      FHEVM_CHAIN_ID,
      "sepolia",
      toOverrides({
        IdentityRegistry: process.env.FHEVM_IDENTITY_REGISTRY,
        ComplianceRules: process.env.FHEVM_COMPLIANCE_RULES,
        CompliantERC20: process.env.FHEVM_COMPLIANT_ERC20,
      })
    )
  : null;

const LOCAL_CONTRACTS = HARDHAT_ENABLED
  ? resolveNetworkContracts(
      31_337,
      "localhost",
      toOverrides({
        IdentityRegistry: process.env.LOCAL_IDENTITY_REGISTRY,
        ComplianceRules: process.env.LOCAL_COMPLIANCE_RULES,
        CompliantERC20: process.env.LOCAL_COMPLIANT_ERC20,
      })
    )
  : null;

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
      identityRegistry: FHEVM_CONTRACTS?.identityRegistry || "",
      complianceRules: FHEVM_CONTRACTS?.complianceRules,
      compliantERC20: FHEVM_CONTRACTS?.compliantERC20,
    },
    explorer: FHEVM_EXPLORER_URL,
    enabled: FHEVM_ENABLED,
  },
  hardhat: {
    id: "hardhat",
    name: "Local (Hardhat)",
    chainId: 31_337,
    rpcUrl: process.env.LOCAL_RPC_URL || "http://127.0.0.1:8545",
    registrarPrivateKey:
      process.env.LOCAL_REGISTRAR_PRIVATE_KEY ||
      process.env.REGISTRAR_PRIVATE_KEY ||
      "",
    type: "fhevm",
    providerId: "mock",
    features: ["encrypted"],
    contracts: {
      identityRegistry: LOCAL_CONTRACTS?.identityRegistry || "",
      complianceRules: LOCAL_CONTRACTS?.complianceRules,
      compliantERC20: LOCAL_CONTRACTS?.compliantERC20,
    },
    enabled: HARDHAT_ENABLED,
  },
  // Future networks can be added here:
  // additional_fhevm: {
  //   id: "fhevm_custom",
  //   name: "fhEVM Custom",
  //   chainId: 12345,
  //   rpcUrl: process.env.FHEVM_CUSTOM_RPC_URL || "",
  //   type: "fhevm",
  //   features: ["encrypted"],
  //   contracts: { identityRegistry: process.env.FHEVM_CUSTOM_REGISTRY || "" },
  //   explorer: "https://example.com",
  //   enabled: process.env.NEXT_PUBLIC_ENABLE_FHEVM_CUSTOM === "true",
  // },
};

/**
 * Get all networks that are enabled and have contracts configured.
 */
export function getEnabledNetworks(): NetworkConfig[] {
  return Object.values(NETWORKS).filter(
    (network) => network.enabled && network.contracts.identityRegistry
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
  txHash: string
): string | undefined {
  const network = getNetworkById(networkId);
  if (!network?.explorer) {
    return;
  }
  return `${network.explorer}/tx/${txHash}`;
}
