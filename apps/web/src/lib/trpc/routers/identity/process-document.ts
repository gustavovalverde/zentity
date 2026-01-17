import { TRPCError } from "@trpc/server";
import z from "zod";

import {
  getSessionFromCookie,
  validateStepAccess,
} from "@/lib/db/onboarding-session";
import { processDocument } from "@/lib/identity/document/document-ocr";

import { publicProcedure } from "../../server";
import { isRateLimited } from "./helpers/rate-limiter";

/**
 * OCR-only document processing used by onboarding.
 *
 * Validates onboarding session, applies rate limiting,
 * and returns extracted document fields for review.
 */
export const processDocumentProcedure = publicProcedure
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

    ctx.span?.setAttribute(
      "onboarding.document_image_bytes",
      Buffer.byteLength(input.image)
    );

    try {
      return await processDocument(
        input.image,
        ctx.requestId,
        ctx.flowId ?? undefined
      );
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes("ECONNREFUSED") ||
          error.message.includes("fetch failed"))
      ) {
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message:
            "Document processing service unavailable. Please try again later.",
        });
      }

      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to process document. Please try a clearer image.",
      });
    }
  });
