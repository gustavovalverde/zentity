/**
 * Attestation Provider Types
 *
 * Defines the interface that all blockchain providers must implement.
 * This abstraction allows supporting multiple networks (fhEVM, EVM, etc.)
 * with a consistent API.
 */

import type { NetworkConfig } from "../config/networks";

/**
 * Parameters for submitting an attestation.
 */
export interface AttestationParams {
  /** User's wallet address to attest */
  userAddress: string;
  /** Identity proof data from Zentity verification */
  identityData: {
    /** Birth year offset (0-255, years since 1900) */
    birthYearOffset: number;
    /** ISO 3166-1 numeric country code */
    countryCode: number;
    /** KYC verification level (0-3) */
    kycLevel: number;
    /** Whether user is blacklisted */
    isBlacklisted: boolean;
  };
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
  /** Transaction status */
  status: "submitted" | "failed";
  /** Transaction hash (if submitted) */
  txHash?: string;
  /** Error message (if failed) */
  error?: string;
  /** Error category for frontend handling */
  errorCode?: AttestationErrorCode;
}

/**
 * Current attestation status for a user on a network.
 */
export interface AttestationStatus {
  /** Whether user has a confirmed attestation */
  isAttested: boolean;
  /** Transaction hash of the attestation */
  txHash?: string;
  /** Block number where attestation was confirmed */
  blockNumber?: number;
  /** Timestamp of attestation */
  attestedAt?: string;
}

/**
 * Transaction confirmation status.
 */
export interface TransactionStatus {
  /** Whether transaction is confirmed */
  confirmed: boolean;
  /** Whether transaction failed/reverted */
  failed: boolean;
  /** Block number (if confirmed) */
  blockNumber?: number;
  /** Error message (if failed) */
  error?: string;
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
  /** Network ID this provider handles */
  readonly networkId: string;

  /** Human-readable network name */
  readonly networkName: string;

  /** Network configuration */
  readonly config: NetworkConfig;

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

  /**
   * Check if a user is attested on this network.
   *
   * @param userAddress - User's wallet address
   * @returns Current attestation status
   */
  getAttestationStatus(userAddress: string): Promise<AttestationStatus>;

  /**
   * Check if a transaction has been confirmed.
   *
   * @param txHash - Transaction hash to check
   * @returns Transaction status
   */
  checkTransaction(txHash: string): Promise<TransactionStatus>;
}
