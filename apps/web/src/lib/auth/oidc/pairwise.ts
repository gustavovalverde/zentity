import "server-only";

import { defineRequestState, hasRequestState } from "@better-auth/core/context";
import { APIError } from "better-auth/api";
import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { env } from "@/env";
import { parseStoredStringArray } from "@/lib/db/adapter-compat";
import { db } from "@/lib/db/connection";
import { oauthClients } from "@/lib/db/schema/oauth-provider";

import {
  isZentityHostedResource,
  normalizeResource,
} from "./haip/resource-metadata";
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

/**
 * Why the provider would refuse these redirect URIs for a pairwise client,
 * with its own wording, or null when it would accept them. Mirrors the checks
 * it runs only when a registration names `subject_type: "pairwise"`.
 */
export function pairwiseRedirectUriProblem(
  redirectUris: readonly string[]
): string | null {
  const urls = redirectUris.flatMap((uri) =>
    URL.canParse(uri) ? [new URL(uri)] : []
  );
  if (
    urls.some(
      (url) =>
        url.protocol !== "http:" && url.protocol !== "https:" && url.host !== ""
    )
  ) {
    return "pairwise clients cannot use custom-scheme redirect URIs that include a host";
  }
  if (new Set(urls.map((url) => url.host)).size > 1) {
    return "pairwise clients with redirect_uris on different hosts require a sector_identifier_uri, which is not yet supported. All redirect_uris must share the same host.";
  }
  return null;
}

export async function computePairwiseSub(
  subjectId: string,
  sector: string,
  secret: string
): Promise<string> {
  return await makeSignature(`${sector}.${subjectId}`, secret);
}

/** `pw(sector, id)`: the provider's pairwise HMAC under `PAIRWISE_SECRET`. */
export function pairwiseValue(sector: string, id: string): Promise<string> {
  return computePairwiseSub(id, sector, env.PAIRWISE_SECRET);
}

/**
 * The sector of a token for one audience outside Zentity. A space cannot
 * occur in a host, a `client/<client_id>` sector, or a normalized resource,
 * so a token sector never equals a client sector.
 */
export function tokenSector(client: SectorClient, audience: string): string {
  return `${clientSector(client)} ${normalizeResource(audience)}`;
}

/**
 * The one audience of an access token outside Zentity, or null when every
 * audience is Zentity-hosted. Requests for more than one are refused before
 * issuance (`normalizeUserTokenResources`).
 */
export function externalAudience(aud: unknown): string | null {
  const external = (Array.isArray(aud) ? aud : [aud]).filter(
    (value): value is string =>
      typeof value === "string" && !isZentityHostedResource(value)
  );
  if (external.length > 1) {
    throw new APIError("BAD_REQUEST", {
      error: "invalid_target",
      error_description: "request one resource outside Zentity per token",
    });
  }
  return external[0] ?? null;
}

// ── Audience-scoped JWT access-token subjects ────────────────────────

/** The user and client of the access token this request is issuing. */
export interface AccessTokenIssuance {
  client: SectorClient & { clientId: string };
  userId: string;
}

const accessTokenIssuanceState = defineRequestState<AccessTokenIssuance | null>(
  () => null
);

/**
 * Records the user and client of the access token being issued. The
 * provider's access-token claim hook is the only place that sees the user id
 * of a JWT whose `sub` the provider already made pairwise.
 */
export function rememberAccessTokenIssuance(
  issuance: AccessTokenIssuance
): Promise<void> {
  return accessTokenIssuanceState.set(issuance);
}

/**
 * Gives a JWT access token to one audience outside Zentity the subject
 * `pw(T(c, A), userId)` in place of the provider's `pw(C(c), userId)`. Only a
 * payload the provider made pairwise, which carries `ba_sub`, changes; the
 * provider's own endpoints read the user id from `ba_sub`.
 */
export async function scopeSubjectToAudience(
  payload: Record<string, unknown>,
  issuance: AccessTokenIssuance
): Promise<Record<string, unknown>> {
  const audience = externalAudience(payload.aud);
  if (!audience) {
    return payload;
  }
  const clientSubject = await pairwiseValue(
    clientSector(issuance.client),
    issuance.userId
  );
  if (
    payload.client_id !== issuance.client.clientId ||
    payload.sub !== clientSubject
  ) {
    throw new Error("The access token is not the one this request issues");
  }
  return {
    ...payload,
    sub: await pairwiseValue(
      tokenSector(issuance.client, audience),
      issuance.userId
    ),
  };
}

/** `scopeSubjectToAudience` for the token the current request issues. */
export async function projectAudienceSubject(
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (payload.ba_sub === undefined || !(await hasRequestState())) {
    return payload;
  }
  const issuance = await accessTokenIssuanceState.get();
  return issuance ? await scopeSubjectToAudience(payload, issuance) : payload;
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
