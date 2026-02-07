import crypto from "node:crypto";

import { db } from "@/lib/db/connection";
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
import { rpEncryptionKeys } from "@/lib/db/schema/compliance";
import {
  encryptedAttributes,
  encryptedSecrets,
  secretWrappers,
  signedClaims,
  zkChallenges,
  zkProofs,
} from "@/lib/db/schema/crypto";
import {
  identityBundles,
  identityDocuments,
  identityVerificationDrafts,
  identityVerificationJobs,
} from "@/lib/db/schema/identity";
import { jwks } from "@/lib/db/schema/jwks";
import { oauthIdentityData } from "@/lib/db/schema/oauth-identity";
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

export interface CreateUserInput {
  id?: string;
  email?: string;
  emailVerified?: boolean;
  image?: string | null;
  createdAt?: string;
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
    await tx.delete(zkProofs).run();
    await tx.delete(identityVerificationJobs).run();
    await tx.delete(identityVerificationDrafts).run();
    await tx.delete(identityDocuments).run();
    await tx.delete(identityBundles).run();
    await tx.delete(jwks).run();
    await tx.delete(oidc4vciIssuedCredentials).run();
    await tx.delete(oidc4vciOffers).run();
    await tx.delete(oidc4idaVerifiedClaims).run();
    await tx.delete(zkChallenges).run();
    // OAuth/compliance tables (delete children before parents)
    await tx.delete(oauthIdentityData).run();
    await tx.delete(rpEncryptionKeys).run();
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
