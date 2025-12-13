/**
 * Skip Liveness API
 *
 * Allows users to skip the liveness verification step.
 * Advances the wizard to step 4 without completing the liveness challenges.
 *
 * Requires: Document verification must be completed (step 2).
 */

import { type NextRequest, NextResponse } from "next/server";
import {
  getSessionFromCookie,
  skipLiveness,
  validateStepAccess,
} from "@/lib/onboarding-session";

interface SkipLivenessResponse {
  success: boolean;
  error?: string;
  newStep?: number;
}

export async function POST(
  _request: NextRequest,
): Promise<NextResponse<SkipLivenessResponse>> {
  try {
    const session = await getSessionFromCookie();

    // Validate session and step requirements
    const validation = validateStepAccess(session, "skip-liveness");
    if (!validation.valid || !validation.session) {
      return NextResponse.json(
        {
          success: false,
          error: validation.error || "Cannot skip liveness at this time",
        },
        { status: 403 },
      );
    }

    const validSession = validation.session;

    // Skip liveness and advance to step 4
    await skipLiveness(validSession.email);

    return NextResponse.json({
      success: true,
      newStep: 4,
    });
  } catch (_error) {
    return NextResponse.json(
      { success: false, error: "Failed to skip liveness" },
      { status: 500 },
    );
  }
}
