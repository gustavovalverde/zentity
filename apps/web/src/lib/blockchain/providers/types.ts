/**
 * Attestation Provider Types
 *
 * Defines the interface for the attestation provider.
 * In v2, the provider signs EIP-712 permits (server-side);
 * encryption and tx submission happen client-side.
 */

import type { AttestPermitData } from "@zentity/fhevm-contracts";
import type { NetworkConfig } from "../networks";

/** Identity data values for attestation */
export interface IdentityData {
  birthYearOffset: number;
  complianceLevel: number;
  countryCode: number;
  isBlacklisted: boolean;
}

/** Result of signing an EIP-712 attestation permit */
export interface PermitResult {
  identityData: IdentityData;
  permit: AttestPermitData;
}

export type AttestationErrorCode =
  | "ALREADY_ATTESTED"
  | "CONTRACT"
  | "ENCRYPTION"
  | "INSUFFICIENT_FUNDS"
  | "NETWORK"
  | "NOT_ATTESTED"
  | "ONLY_REGISTRAR"
  | "UNKNOWN";

export interface AttestationResult {
  error?: string;
  errorCode?: AttestationErrorCode;
  status: "submitted" | "failed";
  txHash?: string;
}

export interface AttestationStatus {
  attestationId?: number | undefined;
  attestedAt?: string | undefined;
  blockNumber?: number | undefined;
  isAttested: boolean;
  txHash?: string | undefined;
}

export interface TransactionStatus {
  blockNumber?: number;
  confirmed: boolean;
  error?: string;
  failed: boolean;
}

export type AttestationTransactionValidation =
  | "valid"
  | "invalid"
  | "pending_lookup";

/**
 * Attestation provider interface.
 *
 * Server-side responsibilities:
 * - Sign EIP-712 permits (registrar authorization)
 * - Registrar-initiated revocation
 * - Read contract state
 *
 * Client-side (not in this interface):
 * - FHEVM encryption
 * - Transaction submission from user wallet
 */
export interface IAttestationProvider {
  checkTransaction(txHash: string): Promise<TransactionStatus>;
  readonly config: NetworkConfig;
  getAttestationStatus(userAddress: string): Promise<AttestationStatus>;
  readonly networkId: string;
  readonly networkName: string;
  revokeAttestation(userAddress: string): Promise<AttestationResult>;
  signPermit(params: {
    userAddress: string;
    identityData: IdentityData;
    proofSetHash?: string;
    policyVersion?: number;
  }): Promise<PermitResult>;
  validateAttestationTransaction(params: {
    txHash: string;
    userAddress: string;
  }): Promise<AttestationTransactionValidation>;
}
