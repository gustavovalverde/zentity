import { type NextRequest, NextResponse } from "next/server";

const LIVENESS_SERVICE_URL =
  process.env.LIVENESS_SERVICE_URL || "http://localhost:5003";

interface BlinkCheckRequest {
  image: string;
  resetSession?: boolean;
}

/**
 * POST /api/liveness/blink-check
 * Proxy to liveness service /blink-check endpoint
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body: BlinkCheckRequest = await request.json();

    if (!body.image) {
      return NextResponse.json({ error: "Image is required" }, { status: 400 });
    }

    const response = await fetch(`${LIVENESS_SERVICE_URL}/blink-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json(
        { error: `Blink check service error: ${error}` },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (_error) {
    return NextResponse.json(
      {
        error: "Failed to perform blink check",
        blinkDetected: false,
        earValue: 0,
        blinkCount: 0,
        faceDetected: false,
      },
      { status: 500 },
    );
  }
}
