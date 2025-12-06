import { NextRequest, NextResponse } from "next/server";

const LIVENESS_SERVICE_URL =
  process.env.LIVENESS_SERVICE_URL || "http://localhost:5003";

interface PassiveMonitorRequest {
  frames: string[];
}

/**
 * POST /api/liveness/passive-monitor
 * Proxy to liveness service /passive-monitor endpoint
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body: PassiveMonitorRequest = await request.json();

    if (!body.frames || body.frames.length === 0) {
      return NextResponse.json(
        { error: "Frames are required" },
        { status: 400 }
      );
    }

    const response = await fetch(`${LIVENESS_SERVICE_URL}/passive-monitor`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json(
        { error: `Passive monitor service error: ${error}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Passive monitor error:", error);
    return NextResponse.json(
      {
        error: "Failed to analyze passive liveness",
        totalBlinks: 0,
        bestFrameIndex: 0,
        isLikelyReal: false,
      },
      { status: 500 }
    );
  }
}
