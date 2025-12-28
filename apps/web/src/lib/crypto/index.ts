/**
 * Cryptography Module - Client-Safe Exports
 *
 * This barrel file only exports modules that are safe for client components.
 * For server-only crypto utilities (fhe-client, challenge-store), import
 * directly from the specific module files.
 */

// Commitment utilities (client-safe, pure crypto)
export { sha256CommitmentHex } from "./commitments";
// Crypto client for client-side ZK proofs (client-safe)
export {
  encryptDOB,
  generateAgeProof,
  generateDocValidityProof,
  generateFaceMatchProof,
  getProofChallenge,
  getUserProof,
  storeAgeProof,
  verifyAgeViaFHE,
} from "./crypto-client";
