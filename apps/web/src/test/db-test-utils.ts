import crypto from "node:crypto";

import { db } from "@/lib/db/connection";
import {
  attestationEvidence,
  blockchainAttestations,
} from "@/lib/db/schema/attestation";
import {
  accounts,
  passkeyCredentials,
  sessions,
  users,
  verifications,
} from "@/lib/db/schema/auth";
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
import { onboardingSessions } from "@/lib/db/schema/onboarding";
import { rpAuthorizationCodes } from "@/lib/db/schema/rp";

export interface CreateUserInput {
  id?: string;
  name?: string;
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
    await tx.delete(rpAuthorizationCodes).run();
    await tx.delete(zkChallenges).run();
    await tx.delete(accounts).run();
    await tx.delete(sessions).run();
    await tx.delete(verifications).run();
    await tx.delete(onboardingSessions).run();
    await tx.delete(passkeyCredentials).run();
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
      name: input.name ?? "Test User",
      email,
      emailVerified: input.emailVerified ?? false,
      image: input.image ?? null,
      createdAt,
      updatedAt,
    })
    .run();

  return id;
}
