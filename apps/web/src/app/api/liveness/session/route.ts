import { type NextRequest, NextResponse } from "next/server";
import {
  createLivenessSession,
  getChallengeInfo,
} from "@/lib/liveness-session-store";
import {
  getSessionFromCookie,
  validateStepAccess,
} from "@/lib/onboarding-session";

export const runtime = "nodejs";

interface CreateSessionRequest {
  numChallenges?: number;
  requireHeadTurn?: boolean;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Validate onboarding session - must have completed step 2 (document upload)
    const onboardingSession = await getSessionFromCookie();
    const validation = validateStepAccess(onboardingSession, "liveness-session");
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error || "Document verification required first" },
        { status: 403 },
      );
    }

    const body = (await request.json()) as CreateSessionRequest;
    const session = createLivenessSession(
      body.numChallenges ?? 2,
      body.requireHeadTurn ?? false,
    );

    const currentChallenge = getChallengeInfo(session);

    return NextResponse.json({
      sessionId: session.sessionId,
      challenges: session.challenges,
      currentIndex: session.currentIndex,
      isComplete: false,
      isPassed: null,
      currentChallenge,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to create liveness session",
      },
      { status: 500 },
    );
  }
}

