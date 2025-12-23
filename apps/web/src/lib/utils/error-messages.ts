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

  // Return first line of original message for unknown errors
  return msg.split("\n")[0] || "An unexpected error occurred";
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
  const lower = msg.toLowerCase();

  // Attestation-specific errors
  if (lower.includes("execution reverted")) {
    return "Transaction rejected by contract. You may already be registered.";
  }

  if (lower.includes("insufficient funds")) {
    return "Registrar wallet needs more testnet ETH. Contact support.";
  }

  // Fall back to generic handler
  return getUserFriendlyError(error);
}
