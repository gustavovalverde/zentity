import crypto from "node:crypto";

import { db } from "@/lib/db/connection";
import { agentTokenSnapshots } from "@/lib/db/schema/agent";
import {
  attestationEvidence,
  blockchainAttestations,
} from "@/lib/db/schema/attestation";
import {
  accounts,
  passkeys,
  sessions,
  users,
  verifications,
} from "@/lib/db/schema/auth";
import { authChallengeSessions } from "@/lib/db/schema/auth-challenge";
import { cibaRequests } from "@/lib/db/schema/ciba";
import { rpEncryptionKeys } from "@/lib/db/schema/compliance";
import {
  encryptedAttributes,
  encryptedSecrets,
  proofArtifacts,
  secretWrappers,
  signedClaims,
  usedIntentJtis,
  verificationChecks,
  zkChallenges,
} from "@/lib/db/schema/crypto";
import { haipPushedRequests, haipVpSessions } from "@/lib/db/schema/haip";
import {
  identityBundles,
  identityVerificationDrafts,
  identityVerificationJobs,
  identityVerifications,
} from "@/lib/db/schema/identity";
import { jwks } from "@/lib/db/schema/jwks";
import {
  oauthAccessTokens,
  oauthClients,
  oauthConsents,
  oauthRefreshTokens,
} from "@/lib/db/schema/oauth-provider";
import { oidc4idaVerifiedClaims } from "@/lib/db/schema/oidc4ida";
import {
  oidc4vciIssuedCredentials,
  oidc4vciOffers,
} from "@/lib/db/schema/oidc4vci";
import { pushSubscriptions } from "@/lib/db/schema/push";
import {
  recoveryChallenges,
  recoveryConfigs,
  recoveryGuardianApprovals,
  recoveryGuardians,
  recoveryIdentifiers,
  recoveryKeyPins,
  recoverySecretWrappers,
} from "@/lib/db/schema/recovery";

interface CreateUserInput {
  createdAt?: string;
  email?: string;
  emailVerified?: boolean;
  id?: string;
  image?: string | null;
  updatedAt?: string;
}

export async function resetDatabase(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(attestationEvidence).run();
    await tx.delete(blockchainAttestations).run();
    await tx.delete(signedClaims).run();
    await tx.delete(encryptedAttributes).run();
    await tx.delete(secretWrappers).run();
    await tx.delete(encryptedSecrets).run();
    await tx.delete(verificationChecks).run();
    await tx.delete(proofArtifacts).run();
    await tx.delete(identityVerificationJobs).run();
    await tx.delete(identityVerificationDrafts).run();
    await tx.delete(identityVerifications).run();
    await tx.delete(identityBundles).run();
    await tx.delete(jwks).run();
    await tx.delete(oidc4vciIssuedCredentials).run();
    await tx.delete(oidc4vciOffers).run();
    await tx.delete(oidc4idaVerifiedClaims).run();
    await tx.delete(zkChallenges).run();
    await tx.delete(usedIntentJtis).run();
    await tx.delete(pushSubscriptions).run();
    await tx.delete(authChallengeSessions).run();
    await tx.delete(cibaRequests).run();
    // Recovery tables (delete children before parents)
    await tx.delete(recoveryGuardianApprovals).run();
    await tx.delete(recoverySecretWrappers).run();
    await tx.delete(recoveryKeyPins).run();
    await tx.delete(recoveryGuardians).run();
    await tx.delete(recoveryChallenges).run();
    await tx.delete(recoveryIdentifiers).run();
    await tx.delete(recoveryConfigs).run();
    await tx.delete(haipPushedRequests).run();
    await tx.delete(haipVpSessions).run();
    // OAuth/compliance tables (delete children before parents)
    await tx.delete(rpEncryptionKeys).run();
    await tx.delete(agentTokenSnapshots).run();
    await tx.delete(oauthAccessTokens).run();
    await tx.delete(oauthRefreshTokens).run();
    await tx.delete(oauthConsents).run();
    await tx.delete(oauthClients).run();
    await tx.delete(accounts).run();
    await tx.delete(sessions).run();
    await tx.delete(verifications).run();
    await tx.delete(passkeys).run();
    await tx.delete(users).run();
  });

  // Clear in-memory caches that reference DB-persisted keys
  const signingKeyCache = (globalThis as Record<symbol, unknown>)[
    Symbol.for("zentity.jwt-signer-key-cache")
  ] as Map<unknown, unknown> | undefined;
  signingKeyCache?.clear();
}

export async function createTestUser(
  input: CreateUserInput = {}
): Promise<string> {
  const id = input.id ?? crypto.randomUUID();
  const createdAt = input.createdAt ?? new Date().toISOString();
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
