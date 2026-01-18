import { unstable_cache } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";

import { getOcrHealth } from "@/lib/identity/document/ocr-client";
import {
  attachRequestContextToSpan,
  resolveRequestContext,
} from "@/lib/observability/request-context";
import { HttpError } from "@/lib/utils/http";

const getCachedOcrHealth = unstable_cache(
  () => getOcrHealth({ trace: false }),
  ["ocr-health"],
  { revalidate: 15 }
);

/**
 * GET /api/ocr/health
 * Proxy to OCR service /health endpoint
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestContext = resolveRequestContext(request.headers);
  attachRequestContextToSpan(requestContext);
  try {
    const data = await getCachedOcrHealth();
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
