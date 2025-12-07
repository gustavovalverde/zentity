/**
 * Liveness Score FHE Encryption API
 *
 * POST /api/crypto/encrypt-liveness - Encrypt a liveness score using FHE
 *
 * Encrypts liveness score (0.0-1.0) as u16 (0-10000) for privacy-preserving
 * threshold comparisons without revealing the actual score.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

const FHE_SERVICE_URL = process.env.FHE_SERVICE_URL || "http://localhost:5001";

interface EncryptLivenessRequest {
  /** Liveness score from 0.0 to 1.0 */
  score: number;
  /** Client key ID for FHE encryption */
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

    const body = (await request.json()) as EncryptLivenessRequest;

    // Validate score
    if (body.score === undefined || body.score === null) {
      return NextResponse.json(
        { error: "score is required (number from 0.0 to 1.0)" },
        { status: 400 }
      );
    }

    if (typeof body.score !== "number" || body.score < 0 || body.score > 1) {
      return NextResponse.json(
        { error: "score must be a number between 0.0 and 1.0" },
        { status: 400 }
      );
    }

    // Call FHE service
    const response = await fetch(`${FHE_SERVICE_URL}/encrypt-liveness`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        score: body.score,
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
      ciphertext: result.ciphertext,
      clientKeyId: result.clientKeyId,
      score: result.score,
    });
  } catch (error) {
    console.error("[Encrypt Liveness] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to encrypt liveness score" },
      { status: 500 }
    );
  }
}
