import "server-only";

import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { env } from "@/env";
import { parseStoredStringArray } from "@/lib/db/adapter-compat";
import { db } from "@/lib/db/connection";
import { oauthClients } from "@/lib/db/schema/oauth-provider";

import {
  resolvePairwiseSubjectId,
  upsertPairwiseSubjectIndex,
} from "./pairwise-subject-index";

export function getPairwiseSector(redirectUris: string[]): string {
  const first = redirectUris[0];
  if (!first) {
    throw new Error("Client has no redirect URIs for sector identifier");
  }
  return new URL(first).host;
}

export async function computePairwiseSub(
  userId: string,
  redirectUris: string[],
  secret: string
): Promise<string> {
  const sector = getPairwiseSector(redirectUris);
  return await makeSignature(`${sector}.${userId}`, secret);
}

export async function resolveSubForClient(
  userId: string,
  client: { subjectType: string | null; redirectUris: string[] }
): Promise<string> {
  if (client.subjectType === "pairwise") {
    const sub = await computePairwiseSub(
      userId,
      client.redirectUris,
      env.PAIRWISE_SECRET
    );
    await upsertPairwiseSubjectIndex({
      sector: getPairwiseSector(client.redirectUris),
      sub,
      subjectId: userId,
      subjectType: "user",
    });
    return sub;
  }
  return userId;
}

/**
 * Reverse direction with pre-fetched client config.
 * Use when the caller already has client data (avoids a redundant query).
 */
export async function resolveUserIdFromSubForClient(
  sub: string,
  client: { subjectType: string | null; redirectUris: string[] }
): Promise<string | null> {
  if (client.subjectType !== "pairwise") {
    return sub;
  }

  return await resolvePairwiseSubjectId({
    sector: getPairwiseSector(client.redirectUris),
    sub,
    subjectType: "user",
  });
}

/**
 * Reverse direction: given a `sub` from an id_token and the issuing client ID,
 * resolve back to the raw userId. Looks up the client first.
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

  return resolveUserIdFromSubForClient(sub, {
    subjectType: client.subjectType,
    redirectUris: parseStoredStringArray(client.redirectUris),
  });
}
