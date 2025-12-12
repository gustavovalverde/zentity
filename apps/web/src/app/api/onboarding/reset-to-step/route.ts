/**
 * Reset to Step API
 *
 * Resets onboarding progress to a specific step.
 * Clears all verification flags from the target step forward.
 * Used when user navigates backward in the wizard.
 */

import { type NextRequest, NextResponse } from "next/server";
import {
  getSessionFromCookie,
  type OnboardingStep,
  resetToStep,
} from "@/lib/onboarding-session";

interface ResetToStepRequest {
  step: OnboardingStep;
}

interface ResetToStepResponse {
  success: boolean;
  error?: string;
  newStep?: number;
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<ResetToStepResponse>> {
  try {
    const session = await getSessionFromCookie();

    if (!session) {
      return NextResponse.json(
        { success: false, error: "No active session" },
        { status: 401 },
      );
    }

    const body = (await request.json()) as ResetToStepRequest;
    const { step } = body;

    if (!step || step < 1 || step > 4) {
      return NextResponse.json(
        { success: false, error: "Invalid step number" },
        { status: 400 },
      );
    }

    // Can only reset to a step at or before current step
    if (step > session.step) {
      return NextResponse.json(
        { success: false, error: "Cannot reset to a future step" },
        { status: 400 },
      );
    }

    // Perform the reset
    await resetToStep(session.email, step as OnboardingStep);

    console.log(
      `[onboarding/reset-to-step] Reset ${session.email} from step ${session.step} to step ${step}`,
    );

    return NextResponse.json({
      success: true,
      newStep: step,
    });
  } catch (error) {
    console.error("Failed to reset to step:", error);
    return NextResponse.json(
      { success: false, error: "Reset failed" },
      { status: 500 },
    );
  }
}
