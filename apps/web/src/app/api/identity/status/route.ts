/**
 * Identity Verification Status API
 *
 * Returns the verification status for the authenticated user.
 * No PII is revealed - only verification flags and status.
 *
 * This endpoint is useful for:
 * - Checking if a user has completed verification
 * - Getting the verification level (none, basic, full)
 * - Checking which verification steps are complete
 */

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { getVerificationStatus } from "@/lib/db";

interface StatusResponse {
  verified: boolean;
  level: "none" | "basic" | "full";
  checks: {
    document: boolean;
    liveness: boolean;
    faceMatch: boolean;
    ageProof: boolean;
  };
}

export async function GET(): Promise<
  NextResponse<StatusResponse | { error: string }>
> {
  try {
    const authResult = await requireSession();
    if (!authResult.ok) return authResult.response;

    const status = getVerificationStatus(authResult.session.user.id);

    return NextResponse.json(status);
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to get verification status" },
      { status: 500 },
    );
  }
}
