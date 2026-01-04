import type { OnboardingSession } from "../schema/onboarding";

import { and, eq, gt, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "../connection";
import { onboardingSessions } from "../schema/onboarding";

const ONBOARDING_SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Create or update an onboarding session by sessionId.
 * If sessionId is not provided, generates a new one.
 * Returns the session including the sessionId for cookie storage.
 */
export async function upsertOnboardingSession(
  data: Partial<OnboardingSession> & { id?: string }
): Promise<OnboardingSession> {
  const sessionId = data.id ?? nanoid();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + Math.floor(ONBOARDING_SESSION_TTL_MS / 1000);

  const updateSet: Partial<typeof onboardingSessions.$inferInsert> = {
    updatedAt: now,
    expiresAt,
  };

  // Only update fields that are explicitly provided
  if (data.step !== undefined) {
    updateSet.step = data.step;
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

  await db
    .insert(onboardingSessions)
    .values({
      id: sessionId,
      step: data.step ?? 1,
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

  const session = await getOnboardingSessionById(sessionId);
  if (!session) {
    throw new Error("Failed to upsert onboarding session");
  }
  return session;
}

/**
 * Get an onboarding session by its sessionId.
 * Returns null if not found or expired.
 */
export async function getOnboardingSessionById(
  sessionId: string
): Promise<OnboardingSession | null> {
  const now = Math.floor(Date.now() / 1000);

  const row = await db
    .select()
    .from(onboardingSessions)
    .where(
      and(
        eq(onboardingSessions.id, sessionId),
        gt(onboardingSessions.expiresAt, now)
      )
    )
    .limit(1)
    .get();

  return row ?? null;
}

/**
 * Delete an onboarding session by its sessionId.
 */
export async function deleteOnboardingSessionById(
  sessionId: string
): Promise<void> {
  await db
    .delete(onboardingSessions)
    .where(eq(onboardingSessions.id, sessionId))
    .run();
}

/**
 * Cleanup expired sessions.
 * Returns the number of sessions deleted.
 */
export async function cleanupExpiredOnboardingSessions(): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const expiredRows = await db
    .select({ id: onboardingSessions.id })
    .from(onboardingSessions)
    .where(sql`${onboardingSessions.expiresAt} < ${now}`)
    .all();

  if (expiredRows.length === 0) {
    return 0;
  }

  await db
    .delete(onboardingSessions)
    .where(sql`${onboardingSessions.expiresAt} < ${now}`)
    .run();

  return expiredRows.length;
}
