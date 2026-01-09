import { eq } from "drizzle-orm";

import { db } from "../connection";
import { type TwoFactor, twoFactor } from "../schema/auth";

export async function getTwoFactorByUserId(
  userId: string
): Promise<TwoFactor | null> {
  const row = await db
    .select()
    .from(twoFactor)
    .where(eq(twoFactor.userId, userId))
    .get();
  return row ?? null;
}

export async function updateTwoFactorBackupCodes(params: {
  userId: string;
  backupCodes: string;
}): Promise<void> {
  await db
    .update(twoFactor)
    .set({ backupCodes: params.backupCodes })
    .where(eq(twoFactor.userId, params.userId))
    .run();
}
