import type { RpAuthorizationCode } from "../schema/rp";

import { and, eq, gt, isNull } from "drizzle-orm";

import { db } from "../connection";
import { rpAuthorizationCodes } from "../schema/rp";

const RP_AUTH_CODE_TTL_SECONDS = 5 * 60; // 5 minutes

export async function createRpAuthorizationCode(input: {
  clientId: string;
  redirectUri: string;
  state?: string;
  userId: string;
}): Promise<{ code: string; expiresAt: number }> {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + RP_AUTH_CODE_TTL_SECONDS;
  const code = crypto.randomUUID();

  await db
    .insert(rpAuthorizationCodes)
    .values({
      code,
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      state: input.state ?? null,
      userId: input.userId,
      createdAt: now,
      expiresAt,
    })
    .run();

  return { code, expiresAt };
}

export async function consumeRpAuthorizationCode(
  code: string
): Promise<RpAuthorizationCode | null> {
  const now = Math.floor(Date.now() / 1000);

  return await db.transaction(async (tx) => {
    const row = await tx
      .select()
      .from(rpAuthorizationCodes)
      .where(
        and(
          eq(rpAuthorizationCodes.code, code),
          gt(rpAuthorizationCodes.expiresAt, now),
          isNull(rpAuthorizationCodes.usedAt)
        )
      )
      .limit(1)
      .get();

    if (!row) {
      return null;
    }

    await tx
      .update(rpAuthorizationCodes)
      .set({ usedAt: now })
      .where(eq(rpAuthorizationCodes.code, code))
      .run();

    return { ...row, usedAt: now };
  });
}
