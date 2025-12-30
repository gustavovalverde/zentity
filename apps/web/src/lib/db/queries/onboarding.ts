import type { OnboardingSession } from "../schema";

import { and, eq, gt, sql } from "drizzle-orm";

import { db } from "../connection";
import { onboardingSessions } from "../schema";

const ONBOARDING_SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

export function upsertOnboardingSession(
  data: Partial<OnboardingSession> & { email: string },
): OnboardingSession {
  const normalizedEmail = data.email.toLowerCase().trim();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + Math.floor(ONBOARDING_SESSION_TTL_MS / 1000);
  const id = crypto.randomUUID();

  const updateSet: Partial<typeof onboardingSessions.$inferInsert> = {
    updatedAt: now,
    expiresAt,
  };

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
      id,
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
      target: onboardingSessions.email,
      set: updateSet,
    })
    .run();

  const session = getOnboardingSessionByEmail(normalizedEmail);
  if (!session) {
    throw new Error("Failed to upsert onboarding session");
  }
  return session;
}

export function getOnboardingSessionByEmail(
  email: string,
): OnboardingSession | null {
  const normalizedEmail = email.toLowerCase().trim();
  const now = Math.floor(Date.now() / 1000);

  const row = db
    .select()
    .from(onboardingSessions)
    .where(
      and(
        eq(onboardingSessions.email, normalizedEmail),
        gt(onboardingSessions.expiresAt, now),
      ),
    )
    .limit(1)
    .get();

  return row ?? null;
}

export function deleteOnboardingSession(email: string): void {
  const normalizedEmail = email.toLowerCase().trim();
  db.delete(onboardingSessions)
    .where(eq(onboardingSessions.email, normalizedEmail))
    .run();
}

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
