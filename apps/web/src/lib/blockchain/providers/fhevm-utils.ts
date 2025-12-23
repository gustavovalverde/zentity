import type { AttestationErrorCode } from "./types";

// IdentityRegistry ABI - attestIdentity + isAttested
export const IDENTITY_REGISTRY_ABI = [
  {
    inputs: [
      { name: "user", type: "address" },
      { name: "encBirthYearOffset", type: "bytes32" },
      { name: "encCountryCode", type: "bytes32" },
      { name: "encKycLevel", type: "bytes32" },
      { name: "encIsBlacklisted", type: "bytes32" },
      { name: "inputProof", type: "bytes" },
    ],
    name: "attestIdentity",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "user", type: "address" }],
    name: "isAttested",
    outputs: [{ type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

/**
 * Categorize error message for better frontend handling.
 */
export function categorizeError(message: string): AttestationErrorCode {
  const m = message.toLowerCase();

  // Network errors
  if (
    m.includes("network") ||
    m.includes("timeout") ||
    m.includes("etimedout") ||
    m.includes("econnrefused") ||
    m.includes("fetch") ||
    m.includes("rate limit")
  ) {
    return "NETWORK";
  }

  // Encryption errors (FHE SDK related)
  if (
    m.includes("encrypt") ||
    m.includes("fhevm") ||
    m.includes("instance") ||
    m.includes("gateway")
  ) {
    return "ENCRYPTION";
  }

  // Contract errors
  if (
    m.includes("revert") ||
    m.includes("execution") ||
    m.includes("nonce") ||
    m.includes("gas") ||
    m.includes("insufficient funds") ||
    m.includes("no funds") ||
    m.includes("no balance")
  ) {
    return "CONTRACT";
  }

  return "UNKNOWN";
}
