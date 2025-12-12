/**
 * Skip Liveness API
 *
 * Allows users to skip the liveness verification step.
 * Advances the wizard to step 3 without completing liveness.
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

    // Skip liveness and advance to step 3
    await skipLiveness(validSession.email);

    console.log(
      `[onboarding/skip-liveness] ${validSession.email} skipped liveness verification`,
    );

    return NextResponse.json({
      success: true,
      newStep: 3,
    });
  } catch (error) {
    console.error("Failed to skip liveness:", error);
    return NextResponse.json(
      { success: false, error: "Failed to skip liveness" },
      { status: 500 },
    );
  }
}
