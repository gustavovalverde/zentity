/**
 * Network Configuration
 *
 * Defines supported blockchain networks for identity attestation.
 * Networks can be enabled/disabled via environment variables.
 *
 * To add a new fhEVM attestation network:
 * 1. Add entry to NETWORKS with unique id
 * 2. Set type to "fhevm" (encrypted)
 * 3. Configure contracts addresses via env vars
 * 4. Enable via NEXT_PUBLIC_ENABLE_{NETWORK}=true
 */
import "server-only";

import {
  chainIdByNetwork,
  getFhevmContractAddresses,
  getIdentityRegistryMirrorAddress,
} from "@zentity/contracts";

import { env } from "@/env";

export type NetworkType = "fhevm";

export type NetworkFeature = "encrypted" | "basic";

type ContractName = "IdentityRegistry" | "ComplianceRules" | "CompliantERC20";

export interface NetworkConfig {
  /** EVM chain ID */
  chainId: number;
  /** Deployed contract addresses */
  contracts: {
    identityRegistry: string;
    complianceRules?: string | undefined;
    compliantERC20?: string | undefined;
  };
  /** Whether this network is currently enabled */
  enabled: boolean;
  /** Block explorer URL (for tx links) */
  explorer?: string | undefined;
  /** Network capabilities */
  features: NetworkFeature[];
  /** Unique identifier (e.g., "fhevm_sepolia", "hardhat") */
  id: string;
  /** Display name for UI */
  name: string;
  /** Registrar private key for this network (server-side only) */
  registrarPrivateKey?: string | undefined;
  /** RPC endpoint URL */
  rpcUrl: string;
  /** Provider type - determines which provider class to use */
  type: NetworkType;
}

interface BaseMirrorConfig {
  /** EVM chain ID */
  chainId: number;
  /** Deployed mirror contract addresses */
  contracts: {
    identityRegistryMirror: string;
  };
  /** Whether the mirror writer/read path is enabled */
  enabled: boolean;
  /** Block explorer URL (for tx links) */
  explorer: string;
  /** Unique identifier */
  id: "base_sepolia";
  /** Display name */
  name: string;
  /** Registrar private key for this network (server-side only) */
  registrarPrivateKey: string;
  /** RPC endpoint URL */
  rpcUrl: string;
  /** Provider type */
  type: "mirror";
}

/**
 * Registry of all supported networks.
 *
 * Networks are enabled via environment variables:
 * - NEXT_PUBLIC_ENABLE_FHEVM (default: true)
 * - NEXT_PUBLIC_ENABLE_HARDHAT (development only)
 */
const FHEVM_NETWORK_ID = "fhevm_sepolia";
const FHEVM_CHAIN_ID = 11_155_111;
const FHEVM_NETWORK_NAME = "fhEVM (Sepolia)";
const FHEVM_EXPLORER_URL = "https://sepolia.etherscan.io";
const BASE_SEPOLIA_NETWORK_ID = "base_sepolia";
const BASE_SEPOLIA_EXPLORER_URL = "https://sepolia.basescan.org";
function toOverrides(values: Record<ContractName, string | undefined>) {
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
    ? getFhevmContractAddresses(chainId, { prefer, overrides })
    : getFhevmContractAddresses(chainId, { prefer });

  return {
    identityRegistry: contracts.IdentityRegistry,
    complianceRules: contracts.ComplianceRules,
    compliantERC20: contracts.CompliantERC20,
  };
}

function resolveBaseSepoliaMirrorAddress(): string | null {
  const configuredAddress =
    env.BASE_SEPOLIA_IDENTITY_REGISTRY_MIRROR?.trim() || undefined;

  try {
    return getIdentityRegistryMirrorAddress("baseSepolia", {
      overrides: configuredAddress
        ? { IdentityRegistryMirror: configuredAddress }
        : undefined,
    });
  } catch {
    return configuredAddress ?? null;
  }
}

const FHEVM_ENABLED = env.NEXT_PUBLIC_ENABLE_FHEVM;
const HARDHAT_ENABLED =
  process.env.NODE_ENV === "development" && env.NEXT_PUBLIC_ENABLE_HARDHAT;
const BASE_SEPOLIA_ENABLED = env.NEXT_PUBLIC_ENABLE_BASE_SEPOLIA;

const FHEVM_CONTRACTS = FHEVM_ENABLED
  ? resolveNetworkContracts(
      FHEVM_CHAIN_ID,
      "sepolia",
      toOverrides({
        IdentityRegistry: env.FHEVM_IDENTITY_REGISTRY,
        ComplianceRules: env.FHEVM_COMPLIANCE_RULES,
        CompliantERC20: env.FHEVM_COMPLIANT_ERC20,
      })
    )
  : null;

const LOCAL_CONTRACTS = HARDHAT_ENABLED
  ? resolveNetworkContracts(
      31_337,
      "localhost",
      toOverrides({
        IdentityRegistry: env.LOCAL_IDENTITY_REGISTRY,
        ComplianceRules: env.LOCAL_COMPLIANCE_RULES,
        CompliantERC20: env.LOCAL_COMPLIANT_ERC20,
      })
    )
  : null;

const BASE_SEPOLIA_MIRROR_ADDRESS = BASE_SEPOLIA_ENABLED
  ? resolveBaseSepoliaMirrorAddress()
  : null;

const NETWORKS: Record<string, NetworkConfig> = {
  [FHEVM_NETWORK_ID]: {
    id: FHEVM_NETWORK_ID,
    name: FHEVM_NETWORK_NAME,
    chainId: FHEVM_CHAIN_ID,
    rpcUrl: env.NEXT_PUBLIC_FHEVM_RPC_URL,
    registrarPrivateKey: env.FHEVM_REGISTRAR_PRIVATE_KEY || "",
    type: "fhevm",
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
    rpcUrl: env.LOCAL_RPC_URL,
    registrarPrivateKey: env.LOCAL_REGISTRAR_PRIVATE_KEY || "",
    type: "fhevm",
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

const BASE_SEPOLIA_MIRROR: BaseMirrorConfig = {
  id: BASE_SEPOLIA_NETWORK_ID,
  name: "Base Sepolia",
  chainId: chainIdByNetwork.baseSepolia,
  rpcUrl: env.BASE_SEPOLIA_RPC_URL || env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL,
  registrarPrivateKey: env.BASE_SEPOLIA_REGISTRAR_PRIVATE_KEY || "",
  type: "mirror",
  contracts: {
    identityRegistryMirror: BASE_SEPOLIA_MIRROR_ADDRESS ?? "",
  },
  explorer: BASE_SEPOLIA_EXPLORER_URL,
  enabled: BASE_SEPOLIA_ENABLED,
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

export function getBaseSepoliaMirrorConfig(): BaseMirrorConfig | null {
  if (
    !(
      BASE_SEPOLIA_MIRROR.enabled &&
      BASE_SEPOLIA_MIRROR.contracts.identityRegistryMirror
    )
  ) {
    return null;
  }

  return BASE_SEPOLIA_MIRROR;
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
