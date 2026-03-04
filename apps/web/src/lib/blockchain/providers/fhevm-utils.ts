import type { AttestationErrorCode } from "./types";

import {
  BaseError,
  ContractFunctionRevertedError,
  ExecutionRevertedError,
  HttpRequestError,
  InsufficientFundsError,
  RpcRequestError,
  TimeoutError,
  WebSocketRequestError,
} from "viem";

/**
 * Categorize error message for better frontend handling.
 */
function findViemError(
  error: unknown,
  predicate: (err: unknown) => boolean
): Error | null {
  if (error instanceof BaseError) {
    return error.walk(predicate) ?? null;
  }
  return null;
}

export function getErrorSummary(error: unknown): {
  shortMessage: string;
  details?: string;
} {
  if (error instanceof BaseError) {
    return {
      shortMessage: error.shortMessage || error.message,
      details: error.details,
    };
  }

  if (error instanceof Error) {
    return {
      shortMessage: error.message,
    };
  }

  return { shortMessage: "Unknown error" };
}

export function categorizeError(error: unknown): AttestationErrorCode {
  if (
    findViemError(
      error,
      (err) =>
        err instanceof TimeoutError ||
        err instanceof HttpRequestError ||
        err instanceof WebSocketRequestError ||
        err instanceof RpcRequestError
    )
  ) {
    return "NETWORK";
  }

  // Check for specific revert errors before generic CONTRACT
  const revertError = findViemError(
    error,
    (err) => err instanceof ContractFunctionRevertedError
  );
  if (revertError && revertError instanceof ContractFunctionRevertedError) {
    const errorName =
      (revertError.data as { errorName?: string })?.errorName?.toLowerCase() ??
      "";
    if (errorName.includes("alreadyattested")) {
      return "ALREADY_ATTESTED";
    }
    if (errorName.includes("notattested")) {
      return "NOT_ATTESTED";
    }
    if (errorName.includes("onlyregistrar")) {
      return "ONLY_REGISTRAR";
    }
    return "CONTRACT";
  }

  if (findViemError(error, (err) => err instanceof InsufficientFundsError)) {
    return "INSUFFICIENT_FUNDS";
  }

  if (findViemError(error, (err) => err instanceof ExecutionRevertedError)) {
    return "CONTRACT";
  }

  // FHE/relayer errors typically don't have stable types; fall back to message.
  const summary = getErrorSummary(error).shortMessage.toLowerCase();
  if (
    summary.includes("encrypt") ||
    summary.includes("fhevm") ||
    summary.includes("gateway") ||
    summary.includes("relayer")
  ) {
    return "ENCRYPTION";
  }

  return "UNKNOWN";
}
