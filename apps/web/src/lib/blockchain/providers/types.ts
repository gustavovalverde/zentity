/**
 * Attestation Provider Types
 *
 * Defines the interface that all blockchain providers must implement.
 * This abstraction allows supporting multiple networks (fhEVM, EVM, etc.)
 * with a consistent API.
 */

import type { NetworkConfig } from "../networks";

/**
 * Parameters for submitting an attestation.
 */
export interface AttestationParams {
  /** Identity proof data from Zentity verification */
  identityData: {
    /** Birth year offset (0-255, years since 1900) */
    birthYearOffset: number;
    /** ISO 3166-1 numeric country code */
    countryCode: number;
    /** Compliance verification level (0-3) */
    complianceLevel: number;
    /** Whether user is blacklisted */
    isBlacklisted: boolean;
  };
  /** User's wallet address to attest */
  userAddress: string;
}

/**
 * Error categories for better frontend handling.
 */
export type AttestationErrorCode =
  | "NETWORK"
  | "ENCRYPTION"
  | "CONTRACT"
  | "UNKNOWN";

/**
 * Result of submitting an attestation transaction.
 */
export interface AttestationResult {
  /** Error message (if failed) */
  error?: string;
  /** Error category for frontend handling */
  errorCode?: AttestationErrorCode;
  /** Transaction status */
  status: "submitted" | "failed";
  /** Transaction hash (if submitted) */
  txHash?: string;
}

/**
 * Current attestation status for a user on a network.
 */
export interface AttestationStatus {
  /** Timestamp of attestation */
  attestedAt?: string;
  /** Block number where attestation was confirmed */
  blockNumber?: number;
  /** Whether user has a confirmed attestation */
  isAttested: boolean;
  /** Transaction hash of the attestation */
  txHash?: string;
}

/**
 * Transaction confirmation status.
 */
export interface TransactionStatus {
  /** Block number (if confirmed) */
  blockNumber?: number;
  /** Whether transaction is confirmed */
  confirmed: boolean;
  /** Error message (if failed) */
  error?: string;
  /** Whether transaction failed/reverted */
  failed: boolean;
}

/**
 * Interface that all attestation providers must implement.
 *
 * Providers handle the network-specific logic for:
 * - Creating encrypted inputs (fhEVM) or plain inputs (EVM)
 * - Signing and submitting transactions
 * - Checking attestation status
 */
export interface IAttestationProvider {
  /**
   * Check if a transaction has been confirmed.
   *
   * @param txHash - Transaction hash to check
   * @returns Transaction status
   */
  checkTransaction(txHash: string): Promise<TransactionStatus>;

  /** Network configuration */
  readonly config: NetworkConfig;

  /**
   * Check if a user is attested on this network.
   *
   * @param userAddress - User's wallet address
   * @returns Current attestation status
   */
  getAttestationStatus(userAddress: string): Promise<AttestationStatus>;
  /** Network ID this provider handles */
  readonly networkId: string;

  /** Human-readable network name */
  readonly networkName: string;

  /**
   * Submit an attestation for a user.
   *
   * For fhEVM networks: Creates encrypted inputs using the selected provider SDK
   * For EVM networks: Submits plain values
   *
   * @param params - Attestation parameters
   * @returns Result with transaction hash or error
   */
  submitAttestation(params: AttestationParams): Promise<AttestationResult>;
}
