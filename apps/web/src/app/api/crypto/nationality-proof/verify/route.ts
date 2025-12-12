/**
 * Nationality Membership Proof Verification API
 *
 * POST /api/crypto/nationality-proof/verify - Verify a nationality membership ZK proof
 */

import { type NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { toServiceErrorPayload } from "@/lib/http-error-payload";
import { verifyNationalityProofZk } from "@/lib/zk-client";

/**
 * POST - Verify nationality membership ZK proof
 *
 * Body: { proof: {...}, publicSignals: [...] }
 * Returns whether the proof is valid
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireSession();
    if (!authResult.ok) return authResult.response;

    const body = await request.json();
    const { proof, publicSignals } = body;

    // Validate inputs
    if (!proof) {
      return NextResponse.json({ error: "proof is required" }, { status: 400 });
    }

    if (!publicSignals || !Array.isArray(publicSignals)) {
      return NextResponse.json(
        { error: "publicSignals is required and must be an array" },
        { status: 400 },
      );
    }

    const result = await verifyNationalityProofZk({ proof, publicSignals });

    return NextResponse.json({
      success: true,
      isValid: result.isValid,
      proofIsMember: result.proofIsMember,
      merkleRoot: result.merkleRoot,
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
