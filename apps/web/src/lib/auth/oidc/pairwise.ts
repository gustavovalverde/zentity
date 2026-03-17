import "server-only";

import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { env } from "@/env";
import { db } from "@/lib/db/connection";
import { users } from "@/lib/db/schema/auth";
import { oauthClients } from "@/lib/db/schema/oauth-provider";

/**
 * Extract the sector identifier (hostname) from redirect URIs.
 * Mirrors the oauth-provider's internal `getSectorIdentifier`.
 */
export function getSectorIdentifier(redirectUris: string | string[]): string {
  const uris: string[] =
    typeof redirectUris === "string" ? JSON.parse(redirectUris) : redirectUris;
  const first = uris[0];
  if (!first) {
    throw new Error("Client has no redirect URIs for sector identifier");
  }
  return new URL(first).host;
}

/**
 * Compute a pairwise subject identifier using HMAC-SHA256.
 * Must produce identical output to the oauth-provider's `computePairwiseSub`.
 */
export async function computePairwiseSub(
  userId: string,
  redirectUris: string | string[],
  secret: string
): Promise<string> {
  const sector = getSectorIdentifier(redirectUris);
  return await makeSignature(`${sector}.${userId}`, secret);
}

/**
 * Forward direction: compute pairwise sub if client uses pairwise, otherwise raw userId.
 */
export async function resolveSubForClient(
  userId: string,
  client: { subjectType: string | null; redirectUris: string | string[] }
): Promise<string> {
  if (client.subjectType === "pairwise") {
    return await computePairwiseSub(
      userId,
      client.redirectUris,
      env.PAIRWISE_SECRET
    );
  }
  return userId;
}

/**
 * Reverse direction with pre-fetched client config: given a `sub` and the
 * issuing client's config, resolve back to the raw userId.
 *
 * Use this when the caller already has client data (avoids a redundant query).
 */
export async function resolveUserIdFromSubForClient(
  sub: string,
  client: { subjectType: string | null; redirectUris: string | string[] }
): Promise<string | null> {
  if (client.subjectType !== "pairwise") {
    return sub;
  }

  // Pairwise reverse: scan users, compute forward, compare.
  // TODO: add pairwise_subjects index table at scale
  const allUsers = await db.select({ id: users.id }).from(users).all();

  for (const user of allUsers) {
    const pairwiseSub = await computePairwiseSub(
      user.id,
      client.redirectUris,
      env.PAIRWISE_SECRET
    );
    if (pairwiseSub === sub) {
      return user.id;
    }
  }

  return null;
}

/**
 * Reverse direction: given a `sub` from an id_token and the issuing client ID,
 * resolve back to the raw userId.
 *
 * Convenience wrapper that looks up the client first.
 */
export async function resolveUserIdFromSub(
  sub: string,
  clientId: string
): Promise<string | null> {
  const client = await db
    .select({
      subjectType: oauthClients.subjectType,
      redirectUris: oauthClients.redirectUris,
    })
    .from(oauthClients)
    .where(eq(oauthClients.clientId, clientId))
    .limit(1)
    .get();

  if (!client) {
    return null;
  }

  return resolveUserIdFromSubForClient(sub, client);
}
