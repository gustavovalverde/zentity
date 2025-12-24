import type { AttestationErrorCode } from "./types";

import { IdentityRegistryABI } from "@/lib/contracts";

// Full IdentityRegistry ABI (kept in sync with contracts package)
export const IDENTITY_REGISTRY_ABI = IdentityRegistryABI;

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
