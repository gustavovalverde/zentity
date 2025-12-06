import { NextRequest, NextResponse } from "next/server";

const OCR_SERVICE_URL =
  process.env.OCR_SERVICE_URL || "http://localhost:5004";

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

    const response = await fetch(`${OCR_SERVICE_URL}/ocr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json(
        { error: `OCR service error: ${error}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("OCR processing error:", error);
    return NextResponse.json(
      {
        error: "Failed to process document",
        documentType: "unknown",
        isValidDRDocument: false,
        confidence: 0,
        extractedData: null,
        validationIssues: ["ocr_service_unavailable"],
        processingTimeMs: 0,
      },
      { status: 500 }
    );
  }
}
