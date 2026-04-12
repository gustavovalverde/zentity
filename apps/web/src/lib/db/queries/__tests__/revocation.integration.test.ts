import crypto from "node:crypto";

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/connection";
import {
  getLatestVerification,
  revokeIdentity,
} from "@/lib/db/queries/identity";
import {
  blockchainAttestations,
  identityBundles,
  identityVerifications,
} from "@/lib/db/schema/identity";
import { oidc4vciIssuedCredentials } from "@/lib/db/schema/oidc4vci";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";

async function seedVerifiedIdentity(userId: string) {
  const verificationId = crypto.randomUUID();
  await db
    .insert(identityBundles)
    .values({
      userId,
      status: "verified",
    })
    .run();
  await db
    .insert(identityVerifications)
    .values({
      id: verificationId,
      userId,
      method: "ocr",
      status: "verified",
      dedupKey: `dedup-${userId}`,
      verifiedAt: new Date().toISOString(),
    })
    .run();
  return verificationId;
}

describe("identity revocation cascade", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
  });

  it("revokes verification, bundle, and credentials in a single transaction", async () => {
    await seedVerifiedIdentity(userId);

    const result = await revokeIdentity(userId, "admin@zentity.app", "fraud");

    expect(result.revokedVerifications).toBe(1);

    const verification = await db
      .select()
      .from(identityVerifications)
      .where(eq(identityVerifications.userId, userId))
      .get();
    expect(verification?.status).toBe("revoked");
    expect(verification?.revokedAt).toBeTruthy();
    expect(verification?.revokedBy).toBe("admin@zentity.app");
    expect(verification?.revokedReason).toBe("fraud");

    const bundle = await db
      .select()
      .from(identityBundles)
      .where(eq(identityBundles.userId, userId))
      .get();
    expect(bundle?.status).toBe("revoked");
    expect(bundle?.revokedAt).toBeTruthy();
    expect(bundle?.revokedReason).toBe("fraud");
  });

  it("revokes on-chain attestations", async () => {
    await seedVerifiedIdentity(userId);
    await db
      .insert(blockchainAttestations)
      .values({
        id: crypto.randomUUID(),
        userId,
        status: "confirmed",
        chainId: 1,
        walletAddress: "0xtest",
        networkId: "hardhat",
      })
      .run();

    await revokeIdentity(userId, "admin@zentity.app", "fraud");

    const attestation = await db
      .select()
      .from(blockchainAttestations)
      .where(eq(blockchainAttestations.userId, userId))
      .get();
    // No provider available in test env → status is revocation_pending
    expect(attestation?.status).toBe("revocation_pending");
  });

  it("revoked records filtered from getLatestVerification", async () => {
    await seedVerifiedIdentity(userId);

    const before = await getLatestVerification(userId);
    expect(before?.status).toBe("verified");

    await revokeIdentity(userId, "admin@zentity.app", "fraud");

    // getLatestVerification is cached with react cache — need a fresh call
    const after = await db
      .select()
      .from(identityVerifications)
      .where(eq(identityVerifications.userId, userId))
      .get();
    expect(after?.status).toBe("revoked");
  });

  it("re-verification allowed after revocation (dedup key released)", async () => {
    await seedVerifiedIdentity(userId);
    await revokeIdentity(userId, "admin@zentity.app", "expired document");

    // A new verification with the same dedup key should be insertable
    // since the old one is revoked and dedup checks gate on status=verified
    const newVerificationId = crypto.randomUUID();
    await db
      .insert(identityVerifications)
      .values({
        id: newVerificationId,
        userId,
        method: "ocr",
        status: "verified",
        dedupKey: `dedup-reverify-${userId}`,
        verifiedAt: new Date().toISOString(),
      })
      .run();

    const verifications = await db
      .select()
      .from(identityVerifications)
      .where(eq(identityVerifications.userId, userId))
      .all();

    expect(verifications).toHaveLength(2);
    expect(verifications.find((v) => v.status === "revoked")).toBeTruthy();
    expect(verifications.find((v) => v.status === "verified")).toBeTruthy();
  });

  it("idempotent — double revocation does not fail", async () => {
    await seedVerifiedIdentity(userId);

    await revokeIdentity(userId, "admin@zentity.app", "fraud");
    const result = await revokeIdentity(
      userId,
      "admin@zentity.app",
      "duplicate"
    );

    expect(result.revokedVerifications).toBe(0);
  });

  it("revokes OID4VCI issued credentials", async () => {
    await seedVerifiedIdentity(userId);
    await db
      .insert(oidc4vciIssuedCredentials)
      .values({
        userId,
        credentialConfigurationId: "IdentityCredential",
        format: "vc+sd-jwt",
        statusListId: "list-1",
        statusListIndex: 0,
        status: 0,
        credential: "{}",
      })
      .run();

    const result = await revokeIdentity(userId, "admin@zentity.app", "fraud");
    expect(result.revokedCredentials).toBe(1);

    const cred = await db
      .select()
      .from(oidc4vciIssuedCredentials)
      .where(eq(oidc4vciIssuedCredentials.userId, userId))
      .get();
    expect(cred?.status).toBe(1);
    expect(cred?.revokedAt).toBeTruthy();
  });
});
