/**
 * Zero-Knowledge Proofs Module - Client-Safe Exports
 *
 * This barrel file only exports modules that are safe for client components.
 * For server-only ZK utilities (noir-verifier, age-proofs), import directly
 * from the specific module files.
 */

// Nationality data and codes (client-safe, just data)
export {
  getCountriesInGroup,
  isNationalityInGroup,
  listGroups,
} from "./nationality-data";

// Noir prover for client-side proof generation (client-safe)

export {
  generateAgeProofNoir,
  generateDocValidityProofNoir,
  generateFaceMatchProofNoir,
  generateNationalityProofNoir,
  getTodayAsInt,
} from "./noir-prover";
// Web worker manager for off-main-thread proving (client-safe)

// Circuit specifications (client-safe)
export type { CircuitType } from "./zk-circuit-spec";

export {
  CIRCUIT_SPECS,
  isCircuitType,
  normalizeChallengeNonce,
  parsePublicInputToNumber,
} from "./zk-circuit-spec";
