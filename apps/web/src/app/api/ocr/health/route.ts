import { type NextRequest, NextResponse } from "next/server";

import { getOcrHealth } from "@/lib/document/ocr-client";
import { HttpError } from "@/lib/utils/http";

/**
 * GET /api/ocr/health
 * Proxy to OCR service /health endpoint
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const requestId =
      request.headers.get("x-request-id") ||
      request.headers.get("x-correlation-id") ||
      undefined;
    const data = await getOcrHealth({ requestId });
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json(
        { status: "unhealthy", error: "OCR service unavailable" },
        { status: error.status }
      );
    }

    return NextResponse.json(
      { status: "unhealthy", error: "OCR service unreachable" },
      { status: 503 }
    );
  }
}
