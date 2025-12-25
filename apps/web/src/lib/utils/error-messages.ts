/**
 * Error Message Utilities
 *
 * User-friendly error message parsing for blockchain operations.
 * Converts technical error messages into actionable user guidance.
 */

/**
 * Check if an error indicates user rejected the transaction.
 */
export function isUserRejectedError(error: unknown): boolean {
  const msg = getErrorMessage(error).toLowerCase();
  return (
    msg.includes("user rejected") ||
    msg.includes("user denied") ||
    msg.includes("rejected the request")
  );
}

/**
 * Extract message from various error types.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "An unexpected error occurred";
}

/**
 * Convert blockchain/wallet error messages to user-friendly text.
 *
 * @param error - The error object or message
 * @returns A user-friendly error message
 */
export function getUserFriendlyError(error: unknown): string {
  const msg = getErrorMessage(error);
  const lower = msg.toLowerCase();

  // User wallet actions
  if (isUserRejectedError(error)) {
    return "Transaction was cancelled.";
  }

  // Blockchain errors
  if (lower.includes("insufficient funds")) {
    return "Insufficient funds for gas fees.";
  }

  if (lower.includes("rate limit") || lower.includes("too many")) {
    return "Too many attempts. Please wait before trying again.";
  }

  if (lower.includes("timeout") || lower.includes("etimedout")) {
    return "Network is slow. Your transaction may still be processing.";
  }

  if (lower.includes("execution reverted")) {
    return "Transaction rejected by contract.";
  }

  if (lower.includes("nonce")) {
    return "Transaction conflict. Please try again in a moment.";
  }

  // Contract-specific errors
  if (lower.includes("accessprohibited")) {
    return "Compliance access not granted. Please grant access and try again.";
  }

  if (lower.includes("unauthorizedciphertext")) {
    return "Unauthorized ciphertext handle. Re-encrypt and retry.";
  }

  // FHE/ACL errors (Zama fhEVM)
  if (lower.includes("sendernotallowed") || msg.includes("0x23dada53")) {
    return "ACL permission denied. The contract lacks permission to grant access. Please re-attest your identity.";
  }

  if (lower.includes("notattested") || msg.includes("0x99efb890")) {
    return "Identity not attested on-chain. Please register your identity first.";
  }

  if (lower.includes("invalidciphertexthandle") || msg.includes("0x72c0afff")) {
    return "Invalid encrypted data handle. Your attestation may be corrupted. Please re-attest.";
  }

  if (lower.includes("handledoesnotexist") || msg.includes("0xa4fbc572")) {
    return "Encrypted data not found. Your attestation may have expired. Please re-attest.";
  }

  // Extract the reason from viem/wagmi errors, or show first 3 lines
  const reasonMatch = msg.match(/reason:\s*(.+)/);
  if (reasonMatch) return reasonMatch[1];
  return (
    msg.split("\n").slice(0, 3).join(" ").slice(0, 200) ||
    "An unexpected error occurred"
  );
}

/**
 * Get user-friendly error for attestation operations.
 * Includes additional attestation-specific error mappings.
 *
 * @param error - The error object or message
 * @returns A user-friendly error message
 */
export function getAttestationError(error: unknown): string {
  const msg = getErrorMessage(error);
  // Extract the reason from viem/tRPC errors, or show more context
  const reasonMatch = msg.match(/reason:\s*(.+)/);
  if (reasonMatch) return reasonMatch[1];
  return (
    msg.split("\n").slice(0, 3).join(" ").slice(0, 200) ||
    "An unexpected error occurred"
  );
}
