/**
 * Nationality Membership Proof Verification API
 *
 * POST /api/crypto/nationality-proof/verify - Verify a nationality membership ZK proof
 */

import { type NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { toServiceErrorPayload } from "@/lib/http-error-payload";
import { verifyNoirProof } from "@/lib/noir-verifier";
import { CIRCUIT_SPECS, parsePublicInputToNumber } from "@/lib/zk-circuit-spec";

/**
 * POST - Verify nationality membership ZK proof
 *
 * Body: { proof: "base64...", publicInputs: ["0x...", "0x...", "0x1"] }
 * Returns whether the proof is valid
 *
 * Public inputs for nationality_membership circuit (with nonce):
 * - [0] merkle_root: The Merkle root of the country group
 * - [1] nonce: Replay resistance nonce
 * - [2] is_member: Boolean result (1 = member, 0 = not member)
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireSession();
    if (!authResult.ok) return authResult.response;

    const body = await request.json();
    const { proof, publicInputs } = body;

    // Validate inputs
    if (!proof) {
      return NextResponse.json(
        { error: "proof is required (base64 encoded)" },
        { status: 400 },
      );
    }

    if (!publicInputs || !Array.isArray(publicInputs)) {
      return NextResponse.json(
        { error: "publicInputs is required and must be an array" },
        { status: 400 },
      );
    }

    if (publicInputs.length < 3) {
      return NextResponse.json(
        {
          error:
            "publicInputs must have at least 3 elements [merkle_root, nonce, is_member]",
        },
        { status: 400 },
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
    // Index 2 is is_member (after merkle_root and nonce)
    const isMember = parsePublicInputToNumber(
      publicInputs[CIRCUIT_SPECS.nationality_membership.resultIndex],
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
      "Failed to verify proof",
    );
    return NextResponse.json(payload, { status });
  }
}
