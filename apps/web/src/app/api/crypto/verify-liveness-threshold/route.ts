/**
 * Liveness Threshold Verification API
 *
 * POST /api/crypto/verify-liveness-threshold - Verify if encrypted liveness score meets threshold
 *
 * Performs homomorphic comparison: encrypted_score >= threshold
 * Only reveals whether the threshold was met, not the actual score.
 */

import { type NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { verifyLivenessThresholdFhe } from "@/lib/fhe-client";
import { toServiceErrorPayload } from "@/lib/http-error-payload";

interface VerifyLivenessThresholdRequest {
  /** Base64-encoded FHE ciphertext of the liveness score */
  ciphertext: string;
  /** Minimum required score (0.0 to 1.0), defaults to 0.3 */
  threshold?: number;
  /** Client key ID for FHE operations */
  clientKeyId?: string;
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireSession();
    if (!authResult.ok) return authResult.response;

    const body = (await request.json()) as VerifyLivenessThresholdRequest;

    // Validate inputs
    if (!body.ciphertext) {
      return NextResponse.json(
        { error: "ciphertext is required" },
        { status: 400 },
      );
    }

    const threshold = body.threshold ?? 0.3; // Default to 0.3 (common anti-spoof threshold)

    if (typeof threshold !== "number" || threshold < 0 || threshold > 1) {
      return NextResponse.json(
        { error: "threshold must be a number between 0.0 and 1.0" },
        { status: 400 },
      );
    }

    const result = await verifyLivenessThresholdFhe({
      ciphertext: body.ciphertext,
      threshold,
      clientKeyId: body.clientKeyId || "default",
    });

    return NextResponse.json({
      success: true,
      passesThreshold: result.passesThreshold,
      threshold: result.threshold,
      computationTimeMs: result.computationTimeMs,
    });
  } catch (error) {
    const { status, payload } = toServiceErrorPayload(
      error,
      "Failed to verify liveness threshold",
    );
    return NextResponse.json(payload, { status });
  }
}
