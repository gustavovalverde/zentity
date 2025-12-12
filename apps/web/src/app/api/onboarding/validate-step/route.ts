/**
 * Step Validation API
 *
 * Validates whether the user can navigate to a specific step.
 * Used by the frontend to check step prerequisites before navigation.
 */

import { type NextRequest, NextResponse } from "next/server";
import {
  getSessionFromCookie,
  type OnboardingStep,
} from "@/lib/onboarding-session";

interface ValidateStepRequest {
  targetStep: OnboardingStep;
}

interface ValidateStepResponse {
  valid: boolean;
  error?: string;
  warning?: string;
  requiresConfirmation?: boolean;
  currentStep?: number;
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<ValidateStepResponse>> {
  try {
    const session = await getSessionFromCookie();

    if (!session) {
      return NextResponse.json(
        {
          valid: false,
          error: "No active session. Please start from the beginning.",
        },
        { status: 401 },
      );
    }

    const body = (await request.json()) as ValidateStepRequest;
    const { targetStep } = body;

    if (!targetStep || targetStep < 1 || targetStep > 4) {
      return NextResponse.json(
        { valid: false, error: "Invalid target step" },
        { status: 400 },
      );
    }

    // Going forward - check prerequisites
    if (targetStep > session.step) {
      // Can only move forward one step at a time
      if (targetStep > session.step + 1) {
        return NextResponse.json({
          valid: false,
          error: "Complete the current step first",
          currentStep: session.step,
        });
      }

      // Check specific step requirements
      if (targetStep === 2 && session.step < 1) {
        return NextResponse.json({
          valid: false,
          error: "Complete email entry first",
          currentStep: session.step,
        });
      }

      if (targetStep === 3 && !session.documentProcessed) {
        return NextResponse.json({
          valid: false,
          error: "Complete document verification first",
          currentStep: session.step,
        });
      }

      if (targetStep === 4) {
        // For final step, need document processed (liveness optional)
        if (!session.documentProcessed) {
          return NextResponse.json({
            valid: false,
            error: "Complete document verification first",
            currentStep: session.step,
          });
        }
      }

      return NextResponse.json({ valid: true, currentStep: session.step });
    }

    // Going backward - warn about reset
    if (targetStep < session.step) {
      return NextResponse.json({
        valid: true,
        warning:
          "Going back will reset your progress from this step forward. You will need to redo the following steps.",
        requiresConfirmation: true,
        currentStep: session.step,
      });
    }

    // Staying on current step
    return NextResponse.json({ valid: true, currentStep: session.step });
  } catch (error) {
    console.error("Failed to validate step:", error);
    return NextResponse.json(
      { valid: false, error: "Validation failed" },
      { status: 500 },
    );
  }
}
