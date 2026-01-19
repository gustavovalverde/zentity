/**
 * Canonical Proof Type Definitions
 *
 * Defines all ZK proof types supported by Zentity, their specifications,
 * and validation helpers. This is the single source of truth for proof type
 * metadata across the codebase.
 *
 * Design alignment with zkpassport where applicable:
 * - AGE → age_verification
 * - EXPIRY_DATE → doc_validity
 * - NATIONALITY_INCLUSION → nationality_membership
 * - FACEMATCH → face_match
 * - BIND → identity_binding (new)
 */

/**
 * All proof types supported by the system.
 * Circuit names match the Noir circuit directory names.
 */
export const ProofType = {
  AGE_VERIFICATION: "age_verification",
  DOC_VALIDITY: "doc_validity",
  NATIONALITY_MEMBERSHIP: "nationality_membership",
  FACE_MATCH: "face_match",
  IDENTITY_BINDING: "identity_binding",
} as const;

export type ProofType = (typeof ProofType)[keyof typeof ProofType];

/**
 * Auth modes that can generate binding secrets.
 * Each mode derives cryptographic material differently.
 */
export const AuthMode = {
  PASSKEY: "passkey",
  OPAQUE: "opaque",
  WALLET: "wallet",
} as const;

export type AuthMode = (typeof AuthMode)[keyof typeof AuthMode];

/**
 * Specification for each proof type's public inputs.
 * Used for verification, storage, and cross-component consistency.
 */
interface ProofTypeSpec {
  circuitName: string;
  minPublicInputs: number;
  nonceIndex: number;
  claimHashIndex: number;
  resultIndex: number;
  publicInputOrder: readonly string[];
  claimRequired?: string;
  description: string;
}

/**
 * Canonical public input specifications per proof type.
 *
 * IMPORTANT: These indices must match the order produced by bb.js
 * for the compiled circuits. When adding new circuits, verify the
 * order by examining the witness output.
 */
export const PROOF_TYPE_SPECS: Record<ProofType, ProofTypeSpec> = {
  [ProofType.AGE_VERIFICATION]: {
    circuitName: "age_verification",
    minPublicInputs: 5,
    nonceIndex: 2,
    claimHashIndex: 3,
    resultIndex: 4,
    publicInputOrder: [
      "current_days",
      "min_age_days",
      "nonce",
      "claim_hash",
      "is_old_enough",
    ],
    claimRequired: "dob_days",
    description: "Proves age meets minimum threshold without revealing DOB",
  },

  [ProofType.DOC_VALIDITY]: {
    circuitName: "doc_validity",
    minPublicInputs: 4,
    nonceIndex: 1,
    claimHashIndex: 2,
    resultIndex: 3,
    publicInputOrder: ["current_date", "nonce", "claim_hash", "is_valid"],
    claimRequired: "expiry_date",
    description: "Proves document is not expired without revealing expiry",
  },

  [ProofType.NATIONALITY_MEMBERSHIP]: {
    circuitName: "nationality_membership",
    minPublicInputs: 4,
    nonceIndex: 1,
    claimHashIndex: 2,
    resultIndex: 3,
    publicInputOrder: ["merkle_root", "nonce", "claim_hash", "is_member"],
    claimRequired: "nationality_code",
    description:
      "Proves nationality is in allowed country group via Merkle proof",
  },

  [ProofType.FACE_MATCH]: {
    circuitName: "face_match",
    minPublicInputs: 4,
    nonceIndex: 1,
    claimHashIndex: 2,
    resultIndex: 3,
    publicInputOrder: ["threshold", "nonce", "claim_hash", "is_match"],
    claimRequired: "similarity_score",
    description: "Proves face similarity exceeds threshold",
  },

  [ProofType.IDENTITY_BINDING]: {
    circuitName: "identity_binding",
    minPublicInputs: 4,
    nonceIndex: 0,
    claimHashIndex: 1,
    resultIndex: 3,
    publicInputOrder: ["nonce", "binding_commitment", "auth_mode", "is_bound"],
    description:
      "Binds proof to user identity across passkey/OPAQUE/wallet auth modes",
  },
};

/**
 * Type guard to check if a value is a valid ProofType.
 */
export function isProofType(value: unknown): value is ProofType {
  return (
    typeof value === "string" &&
    Object.values(ProofType).includes(value as ProofType)
  );
}

/**
 * Normalize a nonce public input to 32-char lowercase hex.
 * Nonces are 128-bit values embedded in field elements.
 */
export function normalizeChallengeNonce(publicInput: string): string {
  const nonce128 = BigInt(publicInput) % BigInt(2) ** BigInt(128);
  return nonce128.toString(16).padStart(32, "0");
}
