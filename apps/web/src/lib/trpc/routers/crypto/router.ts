/**
 * Crypto Router
 *
 * Handles cryptographic operations: FHE encryption, ZK proof verification,
 * and challenge-response anti-replay protection.
 *
 * Key operations:
 * - verifyProof: Verify Noir ZK proofs with policy enforcement
 * - createChallenge: Issue nonces for replay-resistant proof generation
 * - storeProof: Persist verified ZK proofs for authenticated users
 *
 * Policy enforcement:
 * - MIN_AGE_POLICY: Age proofs must verify age >= 18
 * - MIN_FACE_MATCH_THRESHOLD: Face similarity must be >= FACE_MATCH_MIN_CONFIDENCE
 * - Nonce validation prevents proof replay attacks
 */
import "server-only";

import { router } from "../../server";
import {
  challengeStatusProcedure,
  createChallengeProcedure,
} from "./challenge";
import { healthProcedure } from "./health";
import {
  getAllProofsProcedure,
  getSignedClaimsProcedure,
  getUserProofProcedure,
  storeProofProcedure,
  verifyProofProcedure,
} from "./proof";

export const cryptoRouter = router({
  health: healthProcedure,
  verifyProof: verifyProofProcedure,
  createChallenge: createChallengeProcedure,
  challengeStatus: challengeStatusProcedure,
  getUserProof: getUserProofProcedure,
  getAllProofs: getAllProofsProcedure,
  getSignedClaims: getSignedClaimsProcedure,
  storeProof: storeProofProcedure,
});
