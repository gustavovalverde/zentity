/**
 * Nationality Membership Proof Verification API
 *
 * POST /api/zk/nationality-proof/verify - Verify a nationality membership ZK proof
 */

import { type NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/auth/api-auth";
import { POLICY_VERSION } from "@/lib/blockchain/attestation/policy";
import { getZkProofSessionById } from "@/lib/db/queries/crypto";
import { consumeChallenge } from "@/lib/privacy/zk/challenge-store";
import { verifyNoirProof } from "@/lib/privacy/zk/noir-verifier";
import {
  normalizeChallengeNonce,
  PROOF_TYPE_SPECS,
} from "@/lib/privacy/zk/proof-types";
import { resolveAudience } from "@/lib/trpc/routers/zk/audience";
import { toServiceErrorPayload } from "@/lib/utils/http-error-payload";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST - Verify nationality membership ZK proof
 *
 * Body: { proof: "base64...", publicInputs: ["0x...", "0x...", "0x1"] }
 * Returns whether the proof is valid
 *
 * Public inputs for nationality_membership circuit (with nonce):
 * - [0] merkle_root: The Merkle root of the country group
 * - [1] nonce: Replay resistance nonce
 * - [2] claim_hash: Poseidon2(nationality_code, document_hash)
 * - [3] is_member: Boolean result (1 = member, 0 = not member)
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireSession(request.headers);
    if (!authResult.ok) {
      return authResult.response;
    }

    const body = await request.json();
    const { proof, publicInputs, proofSessionId } = body;

    // Validate inputs
    if (!proof) {
      return NextResponse.json(
        { error: "proof is required (base64 encoded)" },
        { status: 400 }
      );
    }

    if (!(publicInputs && Array.isArray(publicInputs))) {
      return NextResponse.json(
        { error: "publicInputs is required and must be an array" },
        { status: 400 }
      );
    }
    if (
      !(typeof proofSessionId === "string" && UUID_REGEX.test(proofSessionId))
    ) {
      return NextResponse.json(
        { error: "proofSessionId is required and must be a UUID" },
        { status: 400 }
      );
    }

    if (publicInputs.length < 4) {
      return NextResponse.json(
        {
          error:
            "publicInputs must have at least 4 elements [merkle_root, nonce, claim_hash, is_member]",
        },
        { status: 400 }
      );
    }

    const nonceHex = normalizeChallengeNonce(
      publicInputs[PROOF_TYPE_SPECS.nationality_membership.nonceIndex]
    );
    const audience = resolveAudience(request);
    const proofSession = await getZkProofSessionById(proofSessionId);
    if (!proofSession) {
      return NextResponse.json(
        { error: "Unknown proof session" },
        { status: 400 }
      );
    }
    if (
      proofSession.userId !== authResult.session.user.id ||
      proofSession.msgSender !== authResult.session.user.id ||
      proofSession.audience !== audience
    ) {
      return NextResponse.json(
        { error: "Proof session context mismatch" },
        { status: 400 }
      );
    }
    if (proofSession.policyVersion !== POLICY_VERSION) {
      return NextResponse.json(
        { error: "Proof session policy version mismatch" },
        { status: 400 }
      );
    }
    if (proofSession.expiresAt < Date.now() || proofSession.closedAt !== null) {
      return NextResponse.json(
        { error: "Proof session is not active" },
        { status: 400 }
      );
    }

    const challenge = await consumeChallenge(
      nonceHex,
      "nationality_membership",
      {
        userId: authResult.session.user.id,
        msgSender: authResult.session.user.id,
        audience,
        proofSessionId,
      }
    );
    if (!challenge) {
      return NextResponse.json(
        { error: "Invalid or expired challenge nonce" },
        { status: 400 }
      );
    }

    // Verify the proof cryptographically
    const result = await verifyNoirProof({
      proof,
      publicInputs,
      circuitType: "nationality_membership",
    });

    // If cryptographic verification failed, return immediately
    if (!result.isValid) {
      return NextResponse.json({
        success: false,
        isValid: false,
        verificationTimeMs: result.verificationTimeMs,
      });
    }

    // Enforce circuit output: is_member must be 1
    // Index 3 is is_member (after merkle_root, nonce, claim_hash)
    const isMember = Number(
      BigInt(publicInputs[PROOF_TYPE_SPECS.nationality_membership.resultIndex])
    );
    if (isMember !== 1) {
      return NextResponse.json({
        success: true,
        isValid: false,
        reason: "Nationality not in group",
        merkleRoot: publicInputs[0],
        verificationTimeMs: result.verificationTimeMs,
      });
    }

    return NextResponse.json({
      success: true,
      isValid: true,
      merkleRoot: publicInputs[0],
      verificationTimeMs: result.verificationTimeMs,
    });
  } catch (error) {
    const { status, payload } = toServiceErrorPayload(
      error,
      "Failed to verify proof"
    );
    return NextResponse.json(payload, { status });
  }
}
