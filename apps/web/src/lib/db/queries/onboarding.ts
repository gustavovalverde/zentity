import type { OnboardingSession } from "../schema";

import { and, eq, gt, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "../connection";
import { onboardingSessions } from "../schema";

const ONBOARDING_SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Create or update an onboarding session by sessionId.
 * If sessionId is not provided, generates a new one.
 * Returns the session including the sessionId for cookie storage.
 */
export function upsertOnboardingSession(
  data: Partial<OnboardingSession> & { id?: string; email?: string | null },
): OnboardingSession {
  const sessionId = data.id ?? nanoid();
  const normalizedEmail = data.email?.toLowerCase().trim() ?? null;
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + Math.floor(ONBOARDING_SESSION_TTL_MS / 1000);

  const updateSet: Partial<typeof onboardingSessions.$inferInsert> = {
    updatedAt: now,
    expiresAt,
  };

  // Only update fields that are explicitly provided
  if (data.email !== undefined) {
    updateSet.email = normalizedEmail;
  }
  if (data.step !== undefined) {
    updateSet.step = data.step;
  }
  if (data.encryptedPii !== undefined) {
    updateSet.encryptedPii = data.encryptedPii;
  }
  if (data.documentHash !== undefined) {
    updateSet.documentHash = data.documentHash;
  }
  if (data.identityDraftId !== undefined) {
    updateSet.identityDraftId = data.identityDraftId;
  }
  if (data.documentProcessed !== undefined) {
    updateSet.documentProcessed = data.documentProcessed;
  }
  if (data.livenessPassed !== undefined) {
    updateSet.livenessPassed = data.livenessPassed;
  }
  if (data.faceMatchPassed !== undefined) {
    updateSet.faceMatchPassed = data.faceMatchPassed;
  }
  if (data.keysSecured !== undefined) {
    updateSet.keysSecured = data.keysSecured;
  }

  db.insert(onboardingSessions)
    .values({
      id: sessionId,
      email: normalizedEmail,
      step: data.step ?? 1,
      encryptedPii: data.encryptedPii ?? null,
      documentHash: data.documentHash ?? null,
      identityDraftId: data.identityDraftId ?? null,
      documentProcessed: data.documentProcessed ?? false,
      livenessPassed: data.livenessPassed ?? false,
      faceMatchPassed: data.faceMatchPassed ?? false,
      keysSecured: data.keysSecured ?? false,
      createdAt: now,
      updatedAt: now,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: onboardingSessions.id,
      set: updateSet,
    })
    .run();

  const session = getOnboardingSessionById(sessionId);
  if (!session) {
    throw new Error("Failed to upsert onboarding session");
  }
  return session;
}

/**
 * Get an onboarding session by its sessionId.
 * Returns null if not found or expired.
 */
export function getOnboardingSessionById(
  sessionId: string,
): OnboardingSession | null {
  const now = Math.floor(Date.now() / 1000);

  const row = db
    .select()
    .from(onboardingSessions)
    .where(
      and(
        eq(onboardingSessions.id, sessionId),
        gt(onboardingSessions.expiresAt, now),
      ),
    )
    .limit(1)
    .get();

  return row ?? null;
}

/**
 * Delete an onboarding session by its sessionId.
 */
export function deleteOnboardingSessionById(sessionId: string): void {
  db.delete(onboardingSessions)
    .where(eq(onboardingSessions.id, sessionId))
    .run();
}

/**
 * Delete all onboarding sessions for a given email.
 * Used during account deletion to clean up orphaned sessions.
 */
export function deleteOnboardingSessionsByEmail(email: string): void {
  const normalizedEmail = email.toLowerCase().trim();
  db.delete(onboardingSessions)
    .where(eq(onboardingSessions.email, normalizedEmail))
    .run();
}

/**
 * Cleanup expired sessions.
 * Returns the number of sessions deleted.
 */
export function cleanupExpiredOnboardingSessions(): number {
  const now = Math.floor(Date.now() / 1000);
  const expiredRows = db
    .select({ id: onboardingSessions.id })
    .from(onboardingSessions)
    .where(sql`${onboardingSessions.expiresAt} < ${now}`)
    .all();

  if (expiredRows.length === 0) return 0;

  db.delete(onboardingSessions)
    .where(sql`${onboardingSessions.expiresAt} < ${now}`)
    .run();

  return expiredRows.length;
}
