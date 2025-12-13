/**
 * Challenge Nonce API for ZK Proof Replay Resistance
 *
 * POST /api/crypto/challenge - Create a new challenge nonce
 * GET /api/crypto/challenge - Get challenge info (for debugging)
 *
 * The nonce must be included as a public input in the ZK proof
 * and will be validated by the verifier.
 */

import { type NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import {
  createChallenge,
  getActiveChallengeCount,
} from "@/lib/challenge-store";
import type { CircuitType } from "@/lib/noir-verifier";

interface ChallengeRequest {
  circuitType: CircuitType;
}

interface ChallengeResponse {
  nonce: string;
  circuitType: CircuitType;
  expiresAt: string;
}

const VALID_CIRCUIT_TYPES: CircuitType[] = [
  "age_verification",
  "doc_validity",
  "nationality_membership",
  "face_match",
];

/**
 * POST - Create a new challenge nonce for proof generation
 */
export async function POST(
  request: NextRequest,
): Promise<NextResponse<ChallengeResponse | { error: string }>> {
  try {
    const authResult = await requireSession();
    if (!authResult.ok) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const userId = authResult.session.user.id;
    const body: ChallengeRequest = await request.json();

    // Validate circuit type
    if (!body.circuitType || !VALID_CIRCUIT_TYPES.includes(body.circuitType)) {
      return NextResponse.json(
        {
          error: `Invalid circuitType. Must be one of: ${VALID_CIRCUIT_TYPES.join(", ")}`,
        },
        { status: 400 },
      );
    }

    // Create challenge bound to user
    const challenge = createChallenge(body.circuitType, userId);

    return NextResponse.json({
      nonce: challenge.nonce,
      circuitType: challenge.circuitType,
      expiresAt: new Date(challenge.expiresAt).toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to create challenge",
      },
      { status: 500 },
    );
  }
}

/**
 * GET - Get challenge system status (for debugging/monitoring)
 */
export async function GET(): Promise<NextResponse> {
  try {
    const authResult = await requireSession();
    if (!authResult.ok) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    return NextResponse.json({
      activeChallenges: getActiveChallengeCount(),
      supportedCircuitTypes: VALID_CIRCUIT_TYPES,
      ttlMinutes: 5,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to get status",
      },
      { status: 500 },
    );
  }
}
