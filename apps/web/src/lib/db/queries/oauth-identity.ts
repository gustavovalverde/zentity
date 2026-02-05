import { and, eq, sql } from "drizzle-orm";

import { db } from "../connection";
import {
  type NewOAuthIdentityData,
  type OAuthIdentityData,
  oauthIdentityData,
} from "../schema/oauth-identity";

/**
 * Get server-encrypted identity data for a user+client pair.
 * Returns null if no identity data exists or if it has expired.
 */
export async function getOAuthIdentityData(
  userId: string,
  clientId: string
): Promise<OAuthIdentityData | null> {
  const row = await db
    .select()
    .from(oauthIdentityData)
    .where(
      and(
        eq(oauthIdentityData.userId, userId),
        eq(oauthIdentityData.clientId, clientId)
      )
    )
    .limit(1)
    .get();

  if (!row) {
    return null;
  }

  // Check expiry
  if (row.expiresAt) {
    const expiryDate = new Date(row.expiresAt);
    if (expiryDate < new Date()) {
      return null;
    }
  }

  return row;
}

/**
 * Upsert server-encrypted identity data for a user+client pair.
 * Called at consent time to capture identity from user's vault.
 */
export async function upsertOAuthIdentityData(
  data: Omit<NewOAuthIdentityData, "createdAt" | "updatedAt">
): Promise<void> {
  await db
    .insert(oauthIdentityData)
    .values({
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: [oauthIdentityData.userId, oauthIdentityData.clientId],
      set: {
        encryptedBlob: data.encryptedBlob,
        consentedScopes: data.consentedScopes,
        capturedAt: data.capturedAt,
        expiresAt: data.expiresAt ?? null,
        updatedAt: sql`datetime('now')`,
      },
    })
    .run();
}

/**
 * Delete identity data for a user+client pair.
 * Called when user revokes consent for an RP.
 */
export async function deleteOAuthIdentityData(
  userId: string,
  clientId: string
): Promise<void> {
  await db
    .delete(oauthIdentityData)
    .where(
      and(
        eq(oauthIdentityData.userId, userId),
        eq(oauthIdentityData.clientId, clientId)
      )
    )
    .run();
}

/**
 * Delete all identity data for a user.
 * Called when user deletes their account.
 */
export async function deleteAllOAuthIdentityDataForUser(
  userId: string
): Promise<void> {
  await db
    .delete(oauthIdentityData)
    .where(eq(oauthIdentityData.userId, userId))
    .run();
}

/**
 * Get all identity data records for a user (for consent management UI).
 */
export function getOAuthIdentityDataByUser(
  userId: string
): Promise<OAuthIdentityData[]> {
  return db
    .select()
    .from(oauthIdentityData)
    .where(eq(oauthIdentityData.userId, userId))
    .all();
}
