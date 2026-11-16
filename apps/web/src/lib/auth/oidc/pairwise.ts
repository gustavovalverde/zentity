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

/** The client fields that determine its pairwise sector. */
export interface SectorClient {
  redirectUris: string[];
  sectorIdentifier: string | null;
}

export interface PairwiseClient extends SectorClient {
  subjectType: string | null;
}

/**
 * The provider's sector rule: the sector stored at registration, or for a row
 * created before sectors were stored, the host of the first redirect URI.
 */
export function clientSector(client: SectorClient): string {
  if (client.sectorIdentifier) {
    return client.sectorIdentifier;
  }
  const first = client.redirectUris[0];
  if (!first) {
    throw new Error("Client has no redirect URIs for sector identifier");
  }
  return new URL(first).host;
}

// Mirrors the provider's `deriveSectorIdentifier`, which it does not export
// (U15 in docs/adr/platform/0002-better-auth-patches.md).
function deriveSectorIdentifier(
  clientId: string,
  redirectUris: readonly string[]
): string {
  const urls = redirectUris.map((uri) => new URL(uri));
  const first = urls[0];
  return first && urls.every((url) => url.protocol === "https:")
    ? first.host
    : `client/${clientId}`;
}

/**
 * Whether replacing a client's redirect URIs keeps its sector. The provider
 * recomputes a stored sector from the new set, and a row without one keeps
 * deriving it from the first redirect host.
 */
export function keepsSector(
  clientId: string,
  client: SectorClient,
  redirectUris: string[]
): boolean {
  try {
    const next = clientSector({
      redirectUris,
      sectorIdentifier: client.sectorIdentifier
        ? deriveSectorIdentifier(clientId, redirectUris)
        : null,
    });
    return next === clientSector(client);
  } catch {
    return false;
  }
}

export async function computePairwiseSub(
  subjectId: string,
  sector: string,
  secret: string
): Promise<string> {
  return await makeSignature(`${sector}.${subjectId}`, secret);
}

export async function resolveSubForClient(
  userId: string,
  client: PairwiseClient
): Promise<string> {
  if (client.subjectType === "pairwise") {
    const sector = clientSector(client);
    const sub = await computePairwiseSub(userId, sector, env.PAIRWISE_SECRET);
    await upsertPairwiseSubjectIndex({
      sector,
      sub,
      subjectId: userId,
      subjectType: "user",
    });
    return sub;
  }
  return userId;
}

export async function findPairwiseClient(
  clientId: string
): Promise<PairwiseClient | null> {
  const client = await db
    .select({
      subjectType: oauthClients.subjectType,
      sectorIdentifier: oauthClients.sectorIdentifier,
      redirectUris: oauthClients.redirectUris,
    })
    .from(oauthClients)
    .where(eq(oauthClients.clientId, clientId))
    .limit(1)
    .get();

  return client
    ? { ...client, redirectUris: parseStoredStringArray(client.redirectUris) }
    : null;
}

export async function resolveSubForClientId(
  userId: string,
  clientId: string
): Promise<string | null> {
  const client = await findPairwiseClient(clientId);
  return client ? await resolveSubForClient(userId, client) : null;
}

/**
 * Reverse direction with pre-fetched client config.
 * Use when the caller already has client data (avoids a redundant query).
 */
async function resolveUserIdFromSubForClient(
  sub: string,
  client: PairwiseClient
): Promise<string | null> {
  if (client.subjectType !== "pairwise") {
    return sub;
  }

  return await resolvePairwiseSubjectId({
    sector: clientSector(client),
    sub,
    subjectType: "user",
  });
}

/**
 * Reverse direction: given the `sub` a client received in an ID token or from
 * UserInfo, and that client's ID, resolve back to the raw userId.
 */
export async function resolveUserIdFromSub(
  sub: string,
  clientId: string
): Promise<string | null> {
  const client = await findPairwiseClient(clientId);
  return client ? await resolveUserIdFromSubForClient(sub, client) : null;
}
