import { NextResponse } from "next/server";

const LIVENESS_SERVICE_URL =
  process.env.LIVENESS_SERVICE_URL || "http://localhost:5003";

/**
 * GET /api/liveness/health
 * Proxy to liveness service health check
 */
export async function GET(): Promise<NextResponse> {
  try {
    const response = await fetch(`${LIVENESS_SERVICE_URL}/health`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      return NextResponse.json(
        { status: "unhealthy", error: "Liveness service not responding" },
        { status: 503 },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (_error) {
    return NextResponse.json(
      { status: "unhealthy", error: "Liveness service unavailable" },
      { status: 503 },
    );
  }
}
