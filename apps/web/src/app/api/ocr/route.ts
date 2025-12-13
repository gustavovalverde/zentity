import { type NextRequest, NextResponse } from "next/server";
import { HttpError } from "@/lib/http";
import { toServiceErrorPayload } from "@/lib/http-error-payload";
import { ocrDocumentOcr } from "@/lib/ocr-client";

interface OCRRequest {
  image: string;
}

/**
 * POST /api/ocr
 * Proxy to OCR service /ocr endpoint for document processing
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body: OCRRequest = await request.json();

    if (!body.image) {
      return NextResponse.json({ error: "Image is required" }, { status: 400 });
    }

    const data = await ocrDocumentOcr({ image: body.image });
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof HttpError) {
      const { status, payload } = toServiceErrorPayload(
        error,
        "OCR service error",
      );
      return NextResponse.json(
        { error: `OCR service error: ${payload.error}` },
        { status },
      );
    }

    return NextResponse.json(
      {
        error: "Failed to process document",
        documentType: "unknown",
        documentOrigin: null,
        confidence: 0,
        extractedData: null,
        validationIssues: ["ocr_service_unavailable"],
        processingTimeMs: 0,
      },
      { status: 500 },
    );
  }
}
