/**
 * BBS+ Proof Verifier
 *
 * Verifies derived BBS+ proofs with selective disclosure.
 * Confirms hidden messages exist without seeing them.
 */

import type { BbsPresentation, BbsProof, BbsVerifyResult } from "./types";

import { bbs } from "./crypto";
import { getClaimOrder } from "./types";

/**
 * Verify a BBS+ derived proof.
 *
 * @param proof - Derived proof to verify
 * @param publicKey - Issuer's public key
 * @param header - Original credential header
 * @returns Verification result
 */
export async function verifyProof(
  proof: BbsProof,
  publicKey: Uint8Array,
  header?: Uint8Array
): Promise<BbsVerifyResult> {
  const totalMessages = getClaimOrder().length;

  try {
    // Build messages map with only revealed messages at their indices
    const messages: Record<number, Uint8Array> = {};
    for (let i = 0; i < proof.revealedIndices.length; i++) {
      const index = proof.revealedIndices[i];
      messages[index] = proof.revealedMessages[i];
    }

    // Validate we have correct number of revealed messages
    if (proof.revealedIndices.length !== proof.revealedMessages.length) {
      return {
        verified: false,
        error: "Mismatch between revealed indices and messages count",
      };
    }

    // Validate indices are within bounds
    for (const index of proof.revealedIndices) {
      if (index < 0 || index >= totalMessages) {
        return {
          verified: false,
          error: `Invalid message index: ${index}`,
        };
      }
    }

    const result = await bbs.bls12381_shake256.verifyProof({
      publicKey,
      header: header ?? new Uint8Array(0),
      presentationHeader: proof.presentationHeader ?? new Uint8Array(0),
      proof: proof.proof,
      messages,
    });

    return { verified: result.verified };
  } catch (error) {
    return {
      verified: false,
      error: error instanceof Error ? error.message : "Verification failed",
    };
  }
}

/**
 * Verify a complete BBS+ presentation.
 *
 * @param presentation - Presentation to verify
 * @returns Verification result
 */
export async function verifyPresentation(
  presentation: BbsPresentation
): Promise<BbsVerifyResult> {
  return await verifyProof(
    presentation.proof,
    presentation.issuerPublicKey,
    presentation.header
  );
}

/**
 * Get the value of a revealed claim from a presentation.
 * Returns undefined if claim is not revealed.
 */
export function getRevealedClaim(
  presentation: BbsPresentation,
  claim: string
): unknown {
  return (presentation.revealedClaims as Record<string, unknown>)[claim];
}
