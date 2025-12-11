import { type NextRequest, NextResponse } from "next/server";

const LIVENESS_SERVICE_URL =
  process.env.LIVENESS_SERVICE_URL || "http://localhost:5003";

interface HeadPoseRequest {
  image: string;
  resetSession?: boolean;
}

/**
 * POST /api/liveness/head-pose
 * Proxy to liveness service /head-pose endpoint
 * Detects head pose (yaw/pitch) in a single frame
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body: HeadPoseRequest = await request.json();

    if (!body.image) {
      return NextResponse.json({ error: "Image is required" }, { status: 400 });
    }

    const response = await fetch(`${LIVENESS_SERVICE_URL}/head-pose`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json(
        { error: `Head pose detection failed: ${error}` },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to detect head pose" },
      { status: 500 },
    );
  }
}
