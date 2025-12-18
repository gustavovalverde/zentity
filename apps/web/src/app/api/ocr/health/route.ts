import { NextResponse } from "next/server";

import { getOcrHealth } from "@/lib/document/ocr-client";
import { HttpError } from "@/lib/utils";

/**
 * GET /api/ocr/health
 * Proxy to OCR service /health endpoint
 */
export async function GET(): Promise<NextResponse> {
  try {
    const data = await getOcrHealth();
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json(
        { status: "unhealthy", error: "OCR service unavailable" },
        { status: error.status },
      );
    }

    return NextResponse.json(
      { status: "unhealthy", error: "OCR service unreachable" },
      { status: 503 },
    );
  }
}
