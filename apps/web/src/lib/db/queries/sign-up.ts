import type { SignUpSession } from "../schema/sign-up";

import { and, eq, gt, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "../connection";
import { signUpSessions } from "../schema/sign-up";

const SIGN_UP_SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Create or update a sign-up session by sessionId.
 * If sessionId is not provided, generates a new one.
 * Returns the session including the sessionId for cookie storage.
 */
export async function upsertSignUpSession(
  data: Partial<SignUpSession> & { id?: string }
): Promise<SignUpSession> {
  const sessionId = data.id ?? nanoid();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + Math.floor(SIGN_UP_SESSION_TTL_MS / 1000);

  const updateSet: Partial<typeof signUpSessions.$inferInsert> = {
    updatedAt: now,
    expiresAt,
  };

  if (data.step !== undefined) {
    updateSet.step = data.step;
  }
  if (data.keysSecured !== undefined) {
    updateSet.keysSecured = data.keysSecured;
  }

  await db
    .insert(signUpSessions)
    .values({
      id: sessionId,
      step: data.step ?? 1,
      keysSecured: data.keysSecured ?? false,
      createdAt: now,
      updatedAt: now,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: signUpSessions.id,
      set: updateSet,
    })
    .run();

  const session = await getSignUpSessionById(sessionId);
  if (!session) {
    throw new Error("Failed to upsert sign-up session");
  }
  return session;
}

/**
 * Get a sign-up session by its sessionId.
 * Returns null if not found or expired.
 */
export async function getSignUpSessionById(
  sessionId: string
): Promise<SignUpSession | null> {
  const now = Math.floor(Date.now() / 1000);

  const row = await db
    .select()
    .from(signUpSessions)
    .where(
      and(eq(signUpSessions.id, sessionId), gt(signUpSessions.expiresAt, now))
    )
    .limit(1)
    .get();

  return row ?? null;
}

/**
 * Delete a sign-up session by its sessionId.
 */
export async function deleteSignUpSessionById(
  sessionId: string
): Promise<void> {
  await db.delete(signUpSessions).where(eq(signUpSessions.id, sessionId)).run();
}

/**
 * Cleanup expired sessions.
 * Returns the number of sessions deleted.
 */
export async function cleanupExpiredSignUpSessions(): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const expiredRows = await db
    .select({ id: signUpSessions.id })
    .from(signUpSessions)
    .where(sql`${signUpSessions.expiresAt} < ${now}`)
    .all();

  if (expiredRows.length === 0) {
    return 0;
  }

  await db
    .delete(signUpSessions)
    .where(sql`${signUpSessions.expiresAt} < ${now}`)
    .run();

  return expiredRows.length;
}
