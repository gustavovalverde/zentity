import { type NextRequest, NextResponse } from "next/server";

const LIVENESS_SERVICE_URL =
  process.env.LIVENESS_SERVICE_URL || "http://localhost:5003";

/**
 * GET /api/liveness/challenge/[sessionId]
 * Proxy to liveness service /challenge/session/{sessionId} endpoint
 * Gets the current state of a challenge session
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
): Promise<NextResponse> {
  try {
    const { sessionId } = await params;

    if (!sessionId) {
      return NextResponse.json(
        { error: "Session ID is required" },
        { status: 400 },
      );
    }

    const response = await fetch(
      `${LIVENESS_SERVICE_URL}/challenge/session/${sessionId}`,
    );

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json(
        { error: `Failed to get session: ${error}` },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to get challenge session" },
      { status: 500 },
    );
  }
}
