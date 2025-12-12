/**
 * Document Processing API Route
 *
 * Privacy-first document analysis using RapidOCR service.
 * Falls back to cloud AI if local service is unavailable.
 *
 * Features:
 * - Document type detection (passport, national ID, driver's license)
 * - International document support
 * - Field extraction (name, document number, DOB, etc.)
 *
 * Security:
 * - Requires valid onboarding session (step 1 must be complete)
 * - Rate limiting is applied to prevent abuse
 * - No data is stored - only processed and returned
 */

import { type NextRequest, NextResponse } from "next/server";
import { type DocumentResult, processDocument } from "@/lib/document-ai";
import {
  getSessionFromCookie,
  validateStepAccess,
} from "@/lib/onboarding-session";

interface ProcessDocumentRequest {
  image: string;
}

// Simple in-memory rate limiter
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10; // 10 requests per minute per IP

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    return true;
  }

  record.count++;
  return false;
}

// Clean up old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimitMap.entries()) {
    if (now > record.resetTime) {
      rateLimitMap.delete(ip);
    }
  }
}, RATE_LIMIT_WINDOW_MS);

export async function POST(
  request: NextRequest,
): Promise<NextResponse<DocumentResult | { error: string }>> {
  try {
    // Validate onboarding session - must have completed step 1 (email)
    const session = await getSessionFromCookie();
    const validation = validateStepAccess(session, "process-document");
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error || "Session required" },
        { status: 403 },
      );
    }

    // Get client IP for rate limiting
    const forwarded = request.headers.get("x-forwarded-for");
    const ip = forwarded ? forwarded.split(",")[0].trim() : "unknown";

    // Apply rate limiting
    if (isRateLimited(ip)) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a moment and try again." },
        { status: 429 },
      );
    }

    const body = (await request.json()) as ProcessDocumentRequest;

    if (!body.image) {
      return NextResponse.json({ error: "Image is required" }, { status: 400 });
    }

    // Process the document using AI vision (local-first)
    const result = await processDocument(body.image);

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error) {
      // OCR service unavailable
      if (
        error.message.includes("ECONNREFUSED") ||
        error.message.includes("fetch failed")
      ) {
        return NextResponse.json(
          {
            error:
              "Document processing service unavailable. Please try again later.",
          },
          { status: 503 },
        );
      }

      // Cloud AI errors
      if (error.message.includes("API key")) {
        return NextResponse.json(
          { error: "AI service configuration error" },
          { status: 500 },
        );
      }

      if (error.message.includes("rate limit")) {
        return NextResponse.json(
          { error: "Service temporarily unavailable, please try again" },
          { status: 429 },
        );
      }
    }

    return NextResponse.json(
      { error: "Failed to process document. Please try a clearer image." },
      { status: 500 },
    );
  }
}
