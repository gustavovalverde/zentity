import { type NextRequest, NextResponse } from "next/server";

const LIVENESS_SERVICE_URL =
  process.env.LIVENESS_SERVICE_URL || "http://localhost:5003";

interface CompleteChallengeRequest {
  sessionId: string;
  challengeType: string;
  passed: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * POST /api/liveness/challenge/complete
 * Proxy to liveness service /challenge/complete endpoint
 * Marks a challenge as completed in a session
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body: CompleteChallengeRequest = await request.json();

    if (!body.sessionId) {
      return NextResponse.json(
        { error: "Session ID is required" },
        { status: 400 },
      );
    }

    if (!body.challengeType) {
      return NextResponse.json(
        { error: "Challenge type is required" },
        { status: 400 },
      );
    }

    const response = await fetch(`${LIVENESS_SERVICE_URL}/challenge/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json(
        { error: `Failed to complete challenge: ${error}` },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to complete challenge" },
      { status: 500 },
    );
  }
}
