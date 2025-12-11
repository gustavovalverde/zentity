import { type NextRequest, NextResponse } from "next/server";

const LIVENESS_SERVICE_URL =
  process.env.LIVENESS_SERVICE_URL || "http://localhost:5003";

interface HeadTurnCheckRequest {
  image: string;
  direction: "left" | "right";
  threshold?: number;
}

/**
 * POST /api/liveness/head-turn-check
 * Proxy to liveness service /head-turn-check endpoint
 * Checks if head is turned in the required direction
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body: HeadTurnCheckRequest = await request.json();

    if (!body.image) {
      return NextResponse.json({ error: "Image is required" }, { status: 400 });
    }

    if (!body.direction || !["left", "right"].includes(body.direction)) {
      return NextResponse.json(
        { error: "Direction must be 'left' or 'right'" },
        { status: 400 },
      );
    }

    const response = await fetch(`${LIVENESS_SERVICE_URL}/head-turn-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json(
        { error: `Head turn check failed: ${error}` },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to check head turn" },
      { status: 500 },
    );
  }
}
