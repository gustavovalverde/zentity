/**
 * Liveness Threshold Verification API
 *
 * POST /api/crypto/verify-liveness-threshold - Verify if encrypted liveness score meets threshold
 *
 * Performs homomorphic comparison: encrypted_score >= threshold
 * Only reveals whether the threshold was met, not the actual score.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

const FHE_SERVICE_URL = process.env.FHE_SERVICE_URL || "http://localhost:5001";

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
    // Verify authentication
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as VerifyLivenessThresholdRequest;

    // Validate inputs
    if (!body.ciphertext) {
      return NextResponse.json(
        { error: "ciphertext is required" },
        { status: 400 }
      );
    }

    const threshold = body.threshold ?? 0.3; // Default to 0.3 (common anti-spoof threshold)

    if (typeof threshold !== "number" || threshold < 0 || threshold > 1) {
      return NextResponse.json(
        { error: "threshold must be a number between 0.0 and 1.0" },
        { status: 400 }
      );
    }

    // Call FHE service
    const response = await fetch(`${FHE_SERVICE_URL}/verify-liveness-threshold`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ciphertext: body.ciphertext,
        threshold,
        clientKeyId: body.clientKeyId || "default",
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "FHE service error" }));
      return NextResponse.json(error, { status: response.status });
    }

    const result = await response.json();

    return NextResponse.json({
      success: true,
      passesThreshold: result.passesThreshold,
      threshold: result.threshold,
      computationTimeMs: result.computationTimeMs,
    });
  } catch (error) {
    console.error("[Verify Liveness Threshold] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to verify liveness threshold" },
      { status: 500 }
    );
  }
}
