/**
 * KYC Router
 *
 * Handles document OCR processing with rate limiting.
 * Proxies document images to the OCR service (Python/RapidOCR)
 * and returns extracted MRZ/visual data.
 *
 * Rate limiting: 10 requests per minute per IP to prevent abuse.
 */
import "server-only";

import { TRPCError } from "@trpc/server";
import z from "zod";
import { processDocument } from "@/lib/document-ocr";
import {
  getSessionFromCookie,
  validateStepAccess,
} from "@/lib/onboarding-session";
import { publicProcedure, router } from "../server";

// In-memory rate limiter. Resets on server restart.
// For production, consider Redis-based rate limiting.
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 10;

let lastRateLimitCleanupTimeMs = 0;

/** Periodically removes expired rate limit entries to prevent memory leaks. */
function cleanupRateLimitMap(now: number): void {
  if (now - lastRateLimitCleanupTimeMs < RATE_LIMIT_WINDOW_MS) return;
  lastRateLimitCleanupTimeMs = now;

  for (const [ip, record] of rateLimitMap.entries()) {
    if (now > record.resetTime) {
      rateLimitMap.delete(ip);
    }
  }
}

/** Checks if an IP has exceeded the rate limit. Increments counter if not. */
function isRateLimited(ip: string): boolean {
  const now = Date.now();
  cleanupRateLimitMap(now);

  const record = rateLimitMap.get(ip);

  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  if (record.count >= RATE_LIMIT_MAX_REQUESTS) return true;
  record.count++;
  return false;
}

export const kycRouter = router({
  /**
   * Processes a document image through OCR.
   *
   * Validates onboarding session, applies rate limiting, then sends
   * the image to the OCR service for MRZ/visual zone extraction.
   */
  processDocument: publicProcedure
    .input(z.object({ image: z.string().min(1, "Image is required") }))
    .mutation(async ({ ctx, input }) => {
      const session = await getSessionFromCookie();
      const validation = validateStepAccess(session, "process-document");
      if (!validation.valid) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: validation.error || "Session required",
        });
      }

      const forwarded = ctx.req.headers.get("x-forwarded-for");
      const ip = forwarded ? forwarded.split(",")[0].trim() : "unknown";

      if (isRateLimited(ip)) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many requests. Please wait a moment and try again.",
        });
      }

      try {
        return await processDocument(input.image);
      } catch (error) {
        if (error instanceof Error) {
          if (
            error.message.includes("ECONNREFUSED") ||
            error.message.includes("fetch failed")
          ) {
            throw new TRPCError({
              code: "SERVICE_UNAVAILABLE",
              message:
                "Document processing service unavailable. Please try again later.",
            });
          }
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to process document. Please try a clearer image.",
        });
      }
    }),
});
