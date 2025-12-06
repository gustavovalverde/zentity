import { NextRequest, NextResponse } from "next/server";

const LIVENESS_SERVICE_URL =
  process.env.LIVENESS_SERVICE_URL || "http://localhost:5003";

interface ChallengeValidateRequest {
  baselineImage: string;
  challengeImage: string;
  challengeType?: string;
  minEmotionChange?: number;
  smileThreshold?: number;
}

/**
 * POST /api/liveness/challenge/validate
 * Proxy to liveness service /challenge/validate endpoint
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body: ChallengeValidateRequest = await request.json();

    if (!body.baselineImage) {
      return NextResponse.json(
        { error: "Baseline image is required" },
        { status: 400 }
      );
    }

    if (!body.challengeImage) {
      return NextResponse.json(
        { error: "Challenge image is required" },
        { status: 400 }
      );
    }

    const response = await fetch(
      `${LIVENESS_SERVICE_URL}/challenge/validate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json(
        { error: `Challenge validation error: ${error}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Challenge validation error:", error);
    return NextResponse.json(
      {
        error: "Failed to validate challenge",
        passed: false,
        message: "Service error during validation",
      },
      { status: 500 }
    );
  }
}
