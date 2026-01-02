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

export function resetDatabase(): void {
  db.transaction((tx) => {
    tx.delete(attestationEvidence).run();
    tx.delete(blockchainAttestations).run();
    tx.delete(signedClaims).run();
    tx.delete(encryptedAttributes).run();
    tx.delete(secretWrappers).run();
    tx.delete(encryptedSecrets).run();
    tx.delete(zkProofs).run();
    tx.delete(identityVerificationJobs).run();
    tx.delete(identityVerificationDrafts).run();
    tx.delete(identityDocuments).run();
    tx.delete(identityBundles).run();
    tx.delete(rpAuthorizationCodes).run();
    tx.delete(zkChallenges).run();
    tx.delete(accounts).run();
    tx.delete(sessions).run();
    tx.delete(verifications).run();
    tx.delete(onboardingSessions).run();
    tx.delete(passkeyCredentials).run();
    tx.delete(users).run();
  });
}

export function createTestUser(input: CreateUserInput = {}): string {
  const id = input.id ?? crypto.randomUUID();
  const createdAt = input.createdAt ?? new Date().toISOString();
  const updatedAt = input.updatedAt ?? createdAt;
  const email = input.email ?? `user-${id}@example.com`;

  db.insert(users)
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
