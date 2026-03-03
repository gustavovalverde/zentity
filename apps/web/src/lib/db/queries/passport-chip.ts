import type { NewPassportChipVerification } from "../schema/identity";

import { and, eq, ne } from "drizzle-orm";
import { cache } from "react";

import { db } from "../connection";
import { passportChipVerifications } from "../schema/identity";

export const getPassportChipVerificationByUserId = cache(
  async function getPassportChipVerificationByUserId(userId: string) {
    return await db
      .select()
      .from(passportChipVerifications)
      .where(eq(passportChipVerifications.userId, userId))
      .get();
  }
);

export async function hasVerifiedChipVerification(
  userId: string
): Promise<boolean> {
  const row = await db
    .select({ id: passportChipVerifications.id })
    .from(passportChipVerifications)
    .where(
      and(
        eq(passportChipVerifications.userId, userId),
        eq(passportChipVerifications.status, "verified")
      )
    )
    .get();
  return !!row;
}

export async function createPassportChipVerification(
  data: NewPassportChipVerification
) {
  return await db
    .insert(passportChipVerifications)
    .values(data)
    .returning()
    .get();
}

/**
 * Check if a nullifier is already used by a different user.
 * Same passport cannot register on multiple accounts.
 */
export async function isNullifierUsedByOtherUser(
  uniqueIdentifier: string,
  userId: string
): Promise<boolean> {
  const row = await db
    .select({ id: passportChipVerifications.id })
    .from(passportChipVerifications)
    .where(
      and(
        eq(passportChipVerifications.uniqueIdentifier, uniqueIdentifier),
        eq(passportChipVerifications.status, "verified"),
        ne(passportChipVerifications.userId, userId)
      )
    )
    .get();
  return !!row;
}
