/**
 * Network Configuration
 *
 * Defines supported blockchain networks for identity attestation.
 * Networks can be enabled/disabled via environment variables.
 *
 * To add a new confidential attestation network:
 * 1. Add entry to NETWORKS with unique id
 * 2. Set type to "confidential" (encrypted)
 * 3. Configure contracts addresses via env vars
 * 4. Enable via NEXT_PUBLIC_ENABLE_{NETWORK}=true
 */
import "server-only";

import {
  chainIdByNetwork,
  getConfidentialContractAddresses,
  getIdentityRegistryMirrorAddress,
} from "@zentity/contracts";

import { env } from "@/env";

export type NetworkType = "confidential";

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
  /** Unique identifier (e.g., "confidential_sepolia", "hardhat") */
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
 * - NEXT_PUBLIC_ENABLE_CONFIDENTIAL_CHAIN (default: true)
 * - NEXT_PUBLIC_ENABLE_HARDHAT (development only)
 */
const CONFIDENTIAL_CHAIN_NETWORK_ID = "confidential_sepolia";
const SEPOLIA_CONFIDENTIAL_CHAIN_ID = 11_155_111;
const CONFIDENTIAL_CHAIN_NETWORK_NAME = "Zama Confidential Sepolia";
const CONFIDENTIAL_CHAIN_EXPLORER_URL = "https://sepolia.etherscan.io";
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
    ? getConfidentialContractAddresses(chainId, { prefer, overrides })
    : getConfidentialContractAddresses(chainId, { prefer });

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

const CONFIDENTIAL_CHAIN_ENABLED = env.NEXT_PUBLIC_ENABLE_CONFIDENTIAL_CHAIN;
const HARDHAT_ENABLED =
  process.env.NODE_ENV === "development" && env.NEXT_PUBLIC_ENABLE_HARDHAT;
const BASE_SEPOLIA_ENABLED = env.NEXT_PUBLIC_ENABLE_BASE_SEPOLIA;

const CONFIDENTIAL_CHAIN_CONTRACTS = CONFIDENTIAL_CHAIN_ENABLED
  ? resolveNetworkContracts(
      SEPOLIA_CONFIDENTIAL_CHAIN_ID,
      "sepolia",
      toOverrides({
        IdentityRegistry: env.CONFIDENTIAL_CHAIN_IDENTITY_REGISTRY,
        ComplianceRules: env.CONFIDENTIAL_CHAIN_COMPLIANCE_RULES,
        CompliantERC20: env.CONFIDENTIAL_CHAIN_COMPLIANT_ERC20,
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
  [CONFIDENTIAL_CHAIN_NETWORK_ID]: {
    id: CONFIDENTIAL_CHAIN_NETWORK_ID,
    name: CONFIDENTIAL_CHAIN_NETWORK_NAME,
    chainId: SEPOLIA_CONFIDENTIAL_CHAIN_ID,
    rpcUrl: env.NEXT_PUBLIC_CONFIDENTIAL_CHAIN_RPC_URL,
    registrarPrivateKey: env.CONFIDENTIAL_CHAIN_REGISTRAR_PRIVATE_KEY || "",
    type: "confidential",
    features: ["encrypted"],
    contracts: {
      identityRegistry: CONFIDENTIAL_CHAIN_CONTRACTS?.identityRegistry || "",
      complianceRules: CONFIDENTIAL_CHAIN_CONTRACTS?.complianceRules,
      compliantERC20: CONFIDENTIAL_CHAIN_CONTRACTS?.compliantERC20,
    },
    explorer: CONFIDENTIAL_CHAIN_EXPLORER_URL,
    enabled: CONFIDENTIAL_CHAIN_ENABLED,
  },
  hardhat: {
    id: "hardhat",
    name: "Local (Hardhat)",
    chainId: 31_337,
    rpcUrl: env.LOCAL_RPC_URL,
    registrarPrivateKey: env.LOCAL_REGISTRAR_PRIVATE_KEY || "",
    type: "confidential",
    features: ["encrypted"],
    contracts: {
      identityRegistry: LOCAL_CONTRACTS?.identityRegistry || "",
      complianceRules: LOCAL_CONTRACTS?.complianceRules,
      compliantERC20: LOCAL_CONTRACTS?.compliantERC20,
    },
    enabled: HARDHAT_ENABLED,
  },
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
