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
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
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

export async function GET(): Promise<NextResponse<StatusResponse | { error: string }>> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const status = getVerificationStatus(session.user.id);

    return NextResponse.json(status);
  } catch (error) {
    console.error("Status check error:", error);
    return NextResponse.json(
      { error: "Failed to get verification status" },
      { status: 500 }
    );
  }
}
