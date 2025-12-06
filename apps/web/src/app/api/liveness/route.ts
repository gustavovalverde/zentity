import { NextRequest, NextResponse } from "next/server";

const LIVENESS_SERVICE_URL =
  process.env.LIVENESS_SERVICE_URL || "http://localhost:5003";

interface LivenessRequest {
  image: string;
  threshold?: number;
}

/**
 * POST /api/liveness
 * Proxy to liveness service /liveness endpoint
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body: LivenessRequest = await request.json();

    if (!body.image) {
      return NextResponse.json({ error: "Image is required" }, { status: 400 });
    }

    const response = await fetch(`${LIVENESS_SERVICE_URL}/liveness`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json(
        { error: `Liveness service error: ${error}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Liveness check error:", error);
    return NextResponse.json(
      {
        error: "Failed to perform liveness check",
        is_real: false,
        antispoof_score: 0,
        face_count: 0,
      },
      { status: 500 }
    );
  }
}
