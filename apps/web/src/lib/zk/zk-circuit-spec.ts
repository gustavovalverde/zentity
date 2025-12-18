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

type CircuitSpec = {
  minPublicInputs: number;
  nonceIndex: number;
  resultIndex: number;
};

/**
 * Canonical public input layout per circuit.
 *
 * IMPORTANT: These indices must match the order produced by bb.js for the compiled circuits.
 */
export const CIRCUIT_SPECS: Record<CircuitType, CircuitSpec> = {
  // [current_year, min_age, nonce, is_old_enough]
  age_verification: { minPublicInputs: 4, nonceIndex: 2, resultIndex: 3 },
  // [current_date, nonce, is_valid]
  doc_validity: { minPublicInputs: 3, nonceIndex: 1, resultIndex: 2 },
  // [merkle_root, nonce, is_member]
  nationality_membership: { minPublicInputs: 3, nonceIndex: 1, resultIndex: 2 },
  // [threshold, nonce, is_match]
  face_match: { minPublicInputs: 3, nonceIndex: 1, resultIndex: 2 },
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
  if (value.startsWith("0x")) return BigInt(value);
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
  const mask128 = (BigInt(1) << BigInt(128)) - BigInt(1);
  const nonce128 = value & mask128;
  return nonce128.toString(16).padStart(32, "0");
}
