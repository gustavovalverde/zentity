import { type NextRequest, NextResponse } from "next/server";

import { sanitizeAndLogApiError } from "@/lib/http/api-utils";
import { HttpError } from "@/lib/http/http";
import {
  getClientIp,
  ocrLimiter,
  rateLimitResponse,
} from "@/lib/http/rate-limit";
import { ocrDocumentOcr } from "@/lib/identity/document/ocr-client";
import {
  attachRequestContextToSpan,
  resolveRequestContext,
} from "@/lib/observability/request-context";

interface OCRRequest {
  image: string;
}

/**
 * POST /api/ocr
 * Proxy to OCR service /ocr endpoint for document processing
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const { limited, retryAfter } = ocrLimiter.check(
    getClientIp(request.headers)
  );
  if (limited) {
    return rateLimitResponse(retryAfter) as NextResponse;
  }

  const requestContext = resolveRequestContext(request.headers);
  attachRequestContextToSpan(requestContext);
  try {
    const body: OCRRequest = await request.json();

    if (!body.image) {
      return NextResponse.json({ error: "Image is required" }, { status: 400 });
    }

    const data = await ocrDocumentOcr({
      image: body.image,
      requestId: requestContext.requestId,
      flowId: requestContext.flowId ?? undefined,
    });
    return NextResponse.json(data);
  } catch (error) {
    const ref = sanitizeAndLogApiError(error, request, { operation: "ocr" });
    const status = error instanceof HttpError ? error.status : 500;

    return NextResponse.json(
      {
        error: `OCR service unavailable. (Ref: ${ref})`,
        documentType: "unknown",
        documentOrigin: null,
        confidence: 0,
        extractedData: null,
        validationIssues: ["ocr_service_unavailable"],
        processingTimeMs: 0,
      },
      { status }
    );
  }
}
