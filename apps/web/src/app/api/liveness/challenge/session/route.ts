import { type NextRequest, NextResponse } from "next/server";

const LIVENESS_SERVICE_URL =
  process.env.LIVENESS_SERVICE_URL || "http://localhost:5003";

interface CreateSessionRequest {
  numChallenges?: number;
  excludeChallenges?: string[];
  requireHeadTurn?: boolean;
}

/**
 * POST /api/liveness/challenge/session
 * Proxy to liveness service /challenge/session endpoint
 * Creates a new multi-challenge liveness session
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body: CreateSessionRequest = await request.json();

    const response = await fetch(`${LIVENESS_SERVICE_URL}/challenge/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json(
        { error: `Failed to create session: ${error}` },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to create challenge session" },
      { status: 500 },
    );
  }
}
