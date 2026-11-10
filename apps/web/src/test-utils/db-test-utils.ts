import type { NewCibaRequest } from "@/lib/db/schema/ciba";

import crypto from "node:crypto";

import { getConfirmationJkt } from "@better-auth/core/oauth2";
import { eq } from "drizzle-orm";

import { createAuthenticationContext } from "@/lib/auth/auth-context";
import { parseStoredStringArray } from "@/lib/db/adapter-compat";
import { db } from "@/lib/db/connection";
import { agentTokenSnapshots } from "@/lib/db/schema/agent";
import {
  accounts,
  authenticationContexts,
  passkeys,
  sessions,
  users,
  verifications,
} from "@/lib/db/schema/auth";
import { cibaRequests, pushSubscriptions } from "@/lib/db/schema/ciba";
import {
  attestationEvidence,
  blockchainAttestations,
  humanityChallenges,
  humanityCredentials,
  identityBundles,
  identityValidityDeliveries,
  identityValidityEvents,
  identityValiditySourceCursors,
  identityVerificationDrafts,
  identityVerificationJobs,
  identityVerifications,
} from "@/lib/db/schema/identity";
import {
  authChallengeSessions,
  haipPushedRequests,
  haipVpSessions,
  oauthAccessTokens,
  oauthClients,
  oauthConsents,
  oauthRefreshTokens,
  pairwiseSubjects,
} from "@/lib/db/schema/oauth-provider";
import {
  oidc4vciIssuedCredentials,
  oidc4vciOffers,
  oidc4vciStatusLists,
} from "@/lib/db/schema/oidc-credentials";
import {
  credentialBindingCommitments,
  encryptedAttributes,
  encryptedSecrets,
  proofArtifacts,
  secretWrappers,
  signedClaims,
  usedIntentJtis,
  verificationChecks,
  zkChallenges,
} from "@/lib/db/schema/privacy";
import { revokedTokens } from "@/lib/db/schema/revoked-tokens";

interface CreateUserInput {
  createdAt?: Date;
  email?: string;
  emailVerified?: boolean;
  id?: string;
  image?: string | null;
  updatedAt?: Date;
}

// Signing keys survive a reset, as they do across a deployment's requests: the
// OAuth provider caches the JWKS and refetches it for an unknown kid at most
// every 30 seconds, so a fresh key per test would leave tokens unverifiable.
export async function resetDatabase(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(attestationEvidence).run();
    await tx.delete(blockchainAttestations).run();
    await tx.delete(humanityChallenges).run();
    await tx.delete(humanityCredentials).run();
    await tx.delete(signedClaims).run();
    await tx.delete(encryptedAttributes).run();
    await tx.delete(credentialBindingCommitments).run();
    await tx.delete(secretWrappers).run();
    await tx.delete(encryptedSecrets).run();
    await tx.delete(verificationChecks).run();
    await tx.delete(proofArtifacts).run();
    await tx.delete(identityVerificationJobs).run();
    await tx.delete(identityVerificationDrafts).run();
    await tx.delete(identityValidityDeliveries).run();
    await tx.delete(identityValidityEvents).run();
    await tx.delete(identityValiditySourceCursors).run();
    await tx.delete(identityVerifications).run();
    await tx.delete(identityBundles).run();
    await tx.delete(oidc4vciIssuedCredentials).run();
    await tx.delete(oidc4vciOffers).run();
    await tx.delete(oidc4vciStatusLists).run();
    await tx.delete(zkChallenges).run();
    await tx.delete(revokedTokens).run();
    await tx.delete(usedIntentJtis).run();
    await tx.delete(pushSubscriptions).run();
    await tx.delete(authChallengeSessions).run();
    await tx.delete(cibaRequests).run();
    await tx.delete(haipPushedRequests).run();
    await tx.delete(haipVpSessions).run();
    // OAuth tables (delete children before parents)
    await tx.delete(agentTokenSnapshots).run();
    await tx.delete(pairwiseSubjects).run();
    await tx.delete(oauthAccessTokens).run();
    await tx.delete(oauthRefreshTokens).run();
    await tx.delete(oauthConsents).run();
    await tx.delete(oauthClients).run();
    await tx.delete(accounts).run();
    await tx.delete(sessions).run();
    await tx.delete(authenticationContexts).run();
    await tx.delete(verifications).run();
    await tx.delete(passkeys).run();
    await tx.delete(users).run();
  });
}

export async function createTestUser(
  input: CreateUserInput = {}
): Promise<string> {
  const id = input.id ?? crypto.randomUUID();
  const createdAt = input.createdAt ?? new Date();
  const updatedAt = input.updatedAt ?? createdAt;
  const email = input.email ?? `user-${id}@example.com`;

  await db
    .insert(users)
    .values({
      id,
      email,
      emailVerified: input.emailVerified ?? false,
      image: input.image ?? null,
      createdAt,
      updatedAt,
    })
    .run();

  return id;
}

// ---------------------------------------------------------------------------
// Auth context helpers
// ---------------------------------------------------------------------------

export async function createTestAuthContext(userId: string): Promise<string> {
  const ctx = await createAuthenticationContext({
    userId,
    loginMethod: "passkey",
    authenticatedAt: new Date(),
    sourceKind: "better_auth",
    referenceType: "session",
  });
  return ctx.id;
}

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

interface TestSessionResult {
  authContextId: string;
  sessionId: string;
  token: string;
}

export async function createTestSession(
  userId: string,
  authContextId?: string
): Promise<TestSessionResult> {
  const resolvedAuthContextId =
    authContextId ?? (await createTestAuthContext(userId));
  const sessionId = crypto.randomUUID();
  const token = crypto.randomUUID();
  const now = new Date();

  await db
    .insert(sessions)
    .values({
      id: sessionId,
      token,
      userId,
      authContextId: resolvedAuthContextId,
      expiresAt: new Date(Date.now() + 3_600_000),
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return { sessionId, token, authContextId: resolvedAuthContextId };
}

// ---------------------------------------------------------------------------
// CIBA request helpers
// ---------------------------------------------------------------------------

type CibaRequestOverrides = Partial<NewCibaRequest> & {
  clientId: string;
  userId: string;
};

interface TestCibaRequestResult {
  authContextId: string | null;
  authReqId: string;
  /** The stored auth_req_id hash that keys CIBA-scoped stores. */
  authReqIdHash: string;
  requestId: string;
}

/**
 * The stored form of a raw `auth_req_id`: the OAuth provider's default token
 * hash (SHA-256, base64url without padding).
 */
export function hashCibaAuthReqId(rawAuthReqId: string): string {
  return crypto
    .createHash("sha256")
    .update(new TextEncoder().encode(rawAuthReqId))
    .digest("base64url");
}

/**
 * Creates a CIBA request for testing. When status is "approved" and no
 * authContextId is provided, one is auto-created, and the request references
 * its own hash, mirroring what a Zentity approval records.
 */
export async function createTestCibaRequest(
  input: CibaRequestOverrides
): Promise<TestCibaRequestResult> {
  const authReqId = input.authReqId ?? crypto.randomUUID();
  const authReqIdHash = hashCibaAuthReqId(authReqId);
  const status = input.status ?? "pending";

  let authContextId: string | null = input.authContextId ?? null;

  if (status === "approved" && !authContextId) {
    authContextId = await createTestAuthContext(input.userId);
  }

  const [row] = await db
    .insert(cibaRequests)
    .values({
      scope: "openid",
      expiresAt: new Date(Date.now() + 300_000),
      ...(status === "approved" ? { referenceId: authReqIdHash } : {}),
      ...input,
      // The CIBA plugin stores the hash of auth_req_id at rest and the token
      // endpoint hashes the raw value for lookup; callers receive the raw value.
      authReqId: authReqIdHash,
      status,
      authContextId,
    })
    .returning({ id: cibaRequests.id });
  if (!row) {
    throw new Error("Failed to create test CIBA request");
  }

  return { authReqId, authReqIdHash, authContextId, requestId: row.id };
}

// ---------------------------------------------------------------------------
// OAuth token storage helpers
// ---------------------------------------------------------------------------

function parseJson(raw: string | null): unknown {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/**
 * Reads an opaque access token's stored row by its presented value, for
 * assertions about what was issued. It validates nothing.
 */
export async function findStoredOpaqueAccessToken(token: string) {
  const row = await db
    .select()
    .from(oauthAccessTokens)
    .where(
      eq(
        oauthAccessTokens.token,
        crypto.createHash("sha256").update(token).digest("base64url")
      )
    )
    .limit(1)
    .get();
  if (!row) {
    return null;
  }
  const exchangeClaims = parseJson(row.exchangeClaims);
  return {
    ...row,
    dpopJkt: getConfirmationJkt(parseJson(row.confirmation)) ?? null,
    exchangeClaims:
      exchangeClaims && typeof exchangeClaims === "object"
        ? (exchangeClaims as Record<string, unknown>)
        : {},
    scopes: parseStoredStringArray(row.scopes),
  };
}
