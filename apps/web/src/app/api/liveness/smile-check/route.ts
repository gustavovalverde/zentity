import { NextRequest, NextResponse } from "next/server";

const LIVENESS_SERVICE_URL =
  process.env.LIVENESS_SERVICE_URL || "http://localhost:5003";

interface SmileCheckRequest {
  image: string;
  threshold?: number;
}

/**
 * POST /api/liveness/smile-check
 * Proxy to liveness service /smile-check endpoint
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body: SmileCheckRequest = await request.json();

    if (!body.image) {
      return NextResponse.json({ error: "Image is required" }, { status: 400 });
    }

    const response = await fetch(`${LIVENESS_SERVICE_URL}/smile-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json(
        { error: `Smile check service error: ${error}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Smile check error:", error);
    return NextResponse.json(
      {
        error: "Failed to perform smile check",
        isSmiling: false,
        happyScore: 0,
        passed: false,
      },
      { status: 500 }
    );
  }
}
