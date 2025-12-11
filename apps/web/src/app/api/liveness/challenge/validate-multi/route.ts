import { type NextRequest, NextResponse } from "next/server";

const LIVENESS_SERVICE_URL =
  process.env.LIVENESS_SERVICE_URL || "http://localhost:5003";

interface ChallengeResult {
  challenge_type: string;
  image: string;
}

interface ValidateMultiRequest {
  baselineImage: string;
  challengeResults: ChallengeResult[];
}

/**
 * POST /api/liveness/challenge/validate-multi
 * Proxy to liveness service /challenge/validate-multi endpoint
 * Validates multiple challenges at once (batch validation)
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body: ValidateMultiRequest = await request.json();

    if (!body.baselineImage) {
      return NextResponse.json(
        { error: "Baseline image is required" },
        { status: 400 },
      );
    }

    if (!body.challengeResults || body.challengeResults.length === 0) {
      return NextResponse.json(
        { error: "Challenge results are required" },
        { status: 400 },
      );
    }

    const response = await fetch(
      `${LIVENESS_SERVICE_URL}/challenge/validate-multi`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json(
        { error: `Multi-challenge validation failed: ${error}` },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to validate challenges" },
      { status: 500 },
    );
  }
}
