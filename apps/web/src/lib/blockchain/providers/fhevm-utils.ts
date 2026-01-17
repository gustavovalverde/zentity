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

  if (
    findViemError(
      error,
      (err) =>
        err instanceof ExecutionRevertedError ||
        err instanceof ContractFunctionRevertedError ||
        err instanceof InsufficientFundsError
    )
  ) {
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
