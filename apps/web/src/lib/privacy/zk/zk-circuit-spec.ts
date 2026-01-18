/**
 * Shared circuit metadata and parsing helpers.
 *
 * Keep all public input ordering/index rules here to avoid drift across:
 * - API verifiers
 * - DB persistence endpoints
 * - Demo relying-party verification routes
 */

export type CircuitType =
  | "age_verification"
  | "doc_validity"
  | "nationality_membership"
  | "face_match";

interface CircuitSpec {
  minPublicInputs: number;
  nonceIndex: number;
  claimHashIndex: number;
  resultIndex: number;
}

/**
 * Canonical public input layout per circuit.
 *
 * IMPORTANT: These indices must match the order produced by bb.js for the compiled circuits.
 */
export const CIRCUIT_SPECS: Record<CircuitType, CircuitSpec> = {
  // [current_days, min_age_days, nonce, claim_hash, is_old_enough]
  age_verification: {
    minPublicInputs: 5,
    nonceIndex: 2,
    claimHashIndex: 3,
    resultIndex: 4,
  },
  // [current_date, nonce, claim_hash, is_valid]
  doc_validity: {
    minPublicInputs: 4,
    nonceIndex: 1,
    claimHashIndex: 2,
    resultIndex: 3,
  },
  // [merkle_root, nonce, claim_hash, is_member]
  nationality_membership: {
    minPublicInputs: 4,
    nonceIndex: 1,
    claimHashIndex: 2,
    resultIndex: 3,
  },
  // [threshold, nonce, claim_hash, is_match]
  face_match: {
    minPublicInputs: 4,
    nonceIndex: 1,
    claimHashIndex: 2,
    resultIndex: 3,
  },
};

export function isCircuitType(value: unknown): value is CircuitType {
  return (
    value === "age_verification" ||
    value === "doc_validity" ||
    value === "nationality_membership" ||
    value === "face_match"
  );
}

/**
 * bb.js public inputs can be decimal strings or 0x-prefixed hex field elements.
 */
function parsePublicInputToBigInt(value: string): bigint {
  if (value.startsWith("0x")) {
    return BigInt(value);
  }
  return BigInt(value);
}

/**
 * Parse a public input into a JS number (only safe for small values).
 */
export function parsePublicInputToNumber(value: string): number {
  const n = parsePublicInputToBigInt(value);
  return Number(n);
}

/**
 * Normalize a nonce public input into the 32-char lowercase hex string stored in the challenge store.
 */
export function normalizeChallengeNonce(publicInput: string): string {
  // Nonces are 128-bit values (16 bytes) embedded into a field element.
  // bb.js typically returns field elements as 32-byte hex (64 chars),
  // so we normalize by parsing and re-encoding the low 128 bits.
  const value = parsePublicInputToBigInt(publicInput);
  const nonce128 = value % BigInt(2) ** BigInt(128);
  return nonce128.toString(16).padStart(32, "0");
}
