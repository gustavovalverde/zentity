import { NextRequest, NextResponse } from "next/server";

const LIVENESS_SERVICE_URL =
  process.env.LIVENESS_SERVICE_URL || "http://localhost:5003";

interface FaceMatchRequest {
  idImage: string;
  selfieImage: string;
  minConfidence?: number;
}

/**
 * POST /api/liveness/face-match
 * Proxy to liveness service /face-match endpoint
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body: FaceMatchRequest = await request.json();

    if (!body.idImage) {
      return NextResponse.json(
        { error: "ID image is required" },
        { status: 400 }
      );
    }

    if (!body.selfieImage) {
      return NextResponse.json(
        { error: "Selfie image is required" },
        { status: 400 }
      );
    }

    const response = await fetch(`${LIVENESS_SERVICE_URL}/face-match`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json(
        { error: `Face match service error: ${error}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Face match error:", error);
    return NextResponse.json(
      {
        error: "Failed to perform face match",
        matched: false,
        confidence: 0,
      },
      { status: 500 }
    );
  }
}
