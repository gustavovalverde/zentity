import { NextRequest, NextResponse } from "next/server";

const LIVENESS_SERVICE_URL =
  process.env.LIVENESS_SERVICE_URL || "http://localhost:5003";

interface DetectRequest {
  image: string;
}

/**
 * POST /api/liveness/detect
 * Proxy to liveness service /detect endpoint (face detection only)
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body: DetectRequest = await request.json();

    if (!body.image) {
      return NextResponse.json({ error: "Image is required" }, { status: 400 });
    }

    const response = await fetch(`${LIVENESS_SERVICE_URL}/detect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json(
        { error: `Detection service error: ${error}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Face detection error:", error);
    return NextResponse.json(
      { error: "Failed to perform face detection", face_count: 0, faces: [] },
      { status: 500 }
    );
  }
}
