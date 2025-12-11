/**
 * Onboarding Session API
 *
 * Manages wizard state server-side with encrypted PII storage.
 *
 * GET - Load current wizard state
 * POST - Save/update wizard state
 * DELETE - Clear wizard session (on completion or cancel)
 *
 * Security: Expired sessions are cleaned up on every request to ensure
 * abandoned PII is promptly deleted (GDPR compliance).
 */

import { type NextRequest, NextResponse } from "next/server";
import {
  loadWizardState,
  saveWizardState,
  updateWizardProgress,
  completeOnboarding,
  type EncryptedPiiData,
} from "@/lib/onboarding-session";
import { cleanupExpiredOnboardingSessions } from "@/lib/db";

/**
 * GET /api/onboarding/session
 *
 * Load current wizard state from cookie + database.
 * Returns navigation state and verification flags (PII stays server-side).
 */
export async function GET() {
  try {
    // Clean up expired sessions on every request (GDPR: don't retain abandoned PII)
    cleanupExpiredOnboardingSessions();

    const state = await loadWizardState();

    if (!state) {
      return NextResponse.json({
        hasSession: false,
        step: 1,
      });
    }

    // Return state WITHOUT raw PII (only flags and metadata)
    return NextResponse.json({
      hasSession: true,
      email: state.email,
      step: state.step,
      documentProcessed: state.documentProcessed,
      livenessPassed: state.livenessPassed,
      faceMatchPassed: state.faceMatchPassed,
      // Indicate if PII exists (but don't send the actual values)
      hasPii: !!state.pii,
      hasExtractedName: !!state.pii?.extractedName,
      hasExtractedDOB: !!state.pii?.extractedDOB,
    });
  } catch (error) {
    console.error("Failed to load wizard state:", error);
    return NextResponse.json(
      { error: "Failed to load session" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/onboarding/session
 *
 * Save or update wizard state.
 * Accepts navigation state and optional PII (which gets encrypted).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { email, step, pii, ...updates } = body as {
      email: string;
      step: number;
      pii?: EncryptedPiiData;
      documentProcessed?: boolean;
      livenessPassed?: boolean;
      faceMatchPassed?: boolean;
      documentHash?: string;
    };

    if (!email) {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 },
      );
    }

    // If only updating progress flags (not creating new session)
    if (updates.documentProcessed !== undefined ||
        updates.livenessPassed !== undefined ||
        updates.faceMatchPassed !== undefined ||
        updates.documentHash !== undefined) {
      await updateWizardProgress(email, {
        step,
        ...updates,
      });
    } else {
      // Full state save (initial creation or step change with PII)
      await saveWizardState({ email, step: step ?? 1 }, pii);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to save wizard state:", error);
    return NextResponse.json(
      { error: "Failed to save session" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/onboarding/session
 *
 * Clear wizard session (called on completion or user cancellation).
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get("email");

    if (!email) {
      // Try to get email from current session
      const state = await loadWizardState();
      if (state?.email) {
        await completeOnboarding(state.email);
        return NextResponse.json({ success: true });
      }
      return NextResponse.json(
        { error: "No session to delete" },
        { status: 400 },
      );
    }

    await completeOnboarding(email);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete wizard session:", error);
    return NextResponse.json(
      { error: "Failed to delete session" },
      { status: 500 },
    );
  }
}
