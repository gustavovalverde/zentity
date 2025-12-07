/**
 * Nationality Membership Proof Verification API
 *
 * POST /api/crypto/nationality-proof/verify - Verify a nationality membership ZK proof
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

const ZK_SERVICE_URL = process.env.ZK_SERVICE_URL || "http://localhost:5002";

/**
 * POST - Verify nationality membership ZK proof
 *
 * Body: { proof: {...}, publicSignals: [...] }
 * Returns whether the proof is valid
 */
export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { proof, publicSignals } = body;

    // Validate inputs
    if (!proof) {
      return NextResponse.json(
        { error: "proof is required" },
        { status: 400 }
      );
    }

    if (!publicSignals || !Array.isArray(publicSignals)) {
      return NextResponse.json(
        { error: "publicSignals is required and must be an array" },
        { status: 400 }
      );
    }

    // Call ZK service to verify proof
    const response = await fetch(`${ZK_SERVICE_URL}/nationality/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proof, publicSignals }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "ZK service error" }));
      return NextResponse.json(error, { status: response.status });
    }

    const result = await response.json();

    return NextResponse.json({
      success: true,
      isValid: result.isValid,
      proofIsMember: result.proofIsMember,
      merkleRoot: result.merkleRoot,
      verificationTimeMs: result.verificationTimeMs,
    });
  } catch (error) {
    console.error("[Nationality Verify] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to verify proof" },
      { status: 500 }
    );
  }
}
