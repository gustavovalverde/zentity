/**
 * Liveness Score FHE Encryption API
 *
 * POST /api/crypto/encrypt-liveness - Encrypt a liveness score using FHE
 *
 * Encrypts liveness score (0.0-1.0) as u16 (0-10000) for privacy-preserving
 * threshold comparisons without revealing the actual score.
 */

import { type NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { encryptLivenessScoreFhe } from "@/lib/fhe-client";
import { toServiceErrorPayload } from "@/lib/http-error-payload";

interface EncryptLivenessRequest {
  /** Liveness score from 0.0 to 1.0 */
  score: number;
  /** Client key ID for FHE encryption */
  clientKeyId?: string;
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireSession();
    if (!authResult.ok) return authResult.response;

    const body = (await request.json()) as EncryptLivenessRequest;

    // Validate score
    if (body.score === undefined || body.score === null) {
      return NextResponse.json(
        { error: "score is required (number from 0.0 to 1.0)" },
        { status: 400 },
      );
    }

    if (typeof body.score !== "number" || body.score < 0 || body.score > 1) {
      return NextResponse.json(
        { error: "score must be a number between 0.0 and 1.0" },
        { status: 400 },
      );
    }

    const result = await encryptLivenessScoreFhe({
      score: body.score,
      clientKeyId: body.clientKeyId || "default",
    });

    return NextResponse.json({
      success: true,
      ciphertext: result.ciphertext,
      clientKeyId: result.clientKeyId,
      score: result.score,
    });
  } catch (error) {
    const { status, payload } = toServiceErrorPayload(
      error,
      "Failed to encrypt liveness score",
    );
    return NextResponse.json(payload, { status });
  }
}
