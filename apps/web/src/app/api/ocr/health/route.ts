import { NextResponse } from "next/server";

const OCR_SERVICE_URL = process.env.OCR_SERVICE_URL || "http://localhost:5004";

/**
 * GET /api/ocr/health
 * Proxy to OCR service /health endpoint
 */
export async function GET(): Promise<NextResponse> {
  try {
    const response = await fetch(`${OCR_SERVICE_URL}/health`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      return NextResponse.json(
        { status: "unhealthy", error: "OCR service unavailable" },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (_error) {
    return NextResponse.json(
      { status: "unhealthy", error: "OCR service unreachable" },
      { status: 503 },
    );
  }
}
