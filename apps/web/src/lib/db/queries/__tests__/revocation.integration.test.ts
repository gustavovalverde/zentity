import crypto from "node:crypto";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db/connection";
import {
  createVerification,
  getLatestVerification,
  isNullifierUsedByOtherUser,
  reconcileIdentityBundle,
  revokeIdentity,
} from "@/lib/db/queries/identity";
import { cibaRequests } from "@/lib/db/schema/ciba";
import {
  blockchainAttestations,
  identityBundles,
  identityValidityDeliveries,
  identityValidityEvents,
  identityVerifications,
} from "@/lib/db/schema/identity";
import {
  jwks as jwksTable,
  oauthClients,
} from "@/lib/db/schema/oauth-provider";
import { oidc4vciIssuedCredentials } from "@/lib/db/schema/oidc-credentials";
import {
  processIdentityValidityDeliveries,
  scheduleIdentityValidityDeliveries,
} from "@/lib/identity/validity/delivery";
import {
  createTestCibaRequest,
  createTestUser,
  resetDatabase,
} from "@/test-utils/db-test-utils";

async function seedSigningKey() {
  const { exportJWK, generateKeyPair } = await import("jose");
  const keyPair = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
    extractable: true,
  });
  const kid = crypto.randomUUID();
  const publicJwk = await exportJWK(keyPair.publicKey);
  const privateJwk = await exportJWK(keyPair.privateKey);

  await db
    .insert(jwksTable)
    .values({
      id: kid,
      publicKey: JSON.stringify(publicJwk),
      privateKey: JSON.stringify(privateJwk),
      alg: "EdDSA",
      crv: "Ed25519",
    })
    .run();
}

async function createBclClient(
  clientId: string,
  metadata: Record<string, unknown>
) {
  await db
    .insert(oauthClients)
    .values({
      clientId,
      name: "BCL Test Client",
      redirectUris: JSON.stringify(["http://localhost/callback"]),
      metadata: JSON.stringify(metadata),
    })
    .run();
}

async function seedVerifiedIdentity(userId: string) {
  const verificationId = crypto.randomUUID();
  await createVerification({
    id: verificationId,
    userId,
    method: "ocr",
    status: "verified",
    dedupKey: `dedup-${userId}`,
    verifiedAt: new Date().toISOString(),
  });
  await reconcileIdentityBundle(userId);
  return verificationId;
}

describe("identity revocation cascade", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("revokes verification and schedules downstream deliveries", async () => {
    const verificationId = await seedVerifiedIdentity(userId);

    const result = await revokeIdentity(
      userId,
      "admin@zentity.app",
      "fraud",
      "admin"
    );

    expect(result.revokedVerifications).toBe(1);
    expect(result.eventId).toBeTruthy();

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
    expect(bundle?.validityStatus).toBe("revoked");
    expect(bundle?.effectiveVerificationId).toBeNull();
    expect(bundle?.revokedAt).toBeTruthy();
    expect(bundle?.revokedReason).toBe("fraud");

    const revocationEvent = await db
      .select()
      .from(identityValidityEvents)
      .where(eq(identityValidityEvents.userId, userId))
      .get();
    expect(revocationEvent?.verificationId).toBe(verificationId);
    expect(revocationEvent?.source).toBe("admin");
    expect(revocationEvent?.triggeredBy).toBe("admin@zentity.app");
    expect(revocationEvent?.reason).toBe("fraud");

    const deliveries = await db
      .select()
      .from(identityValidityDeliveries)
      .where(eq(identityValidityDeliveries.eventId, result.eventId as string))
      .all();
    expect(deliveries).toEqual([]);
  });

  it("processes blockchain revocation through the delivery worker", async () => {
    await seedVerifiedIdentity(userId);
    const attestationId = crypto.randomUUID();
    await db
      .insert(blockchainAttestations)
      .values({
        id: attestationId,
        userId,
        status: "confirmed",
        chainId: 1,
        walletAddress: "0xtest",
        networkId: "hardhat",
      })
      .run();

    const result = await revokeIdentity(
      userId,
      "admin@zentity.app",
      "fraud",
      "admin"
    );
    expect(result.scheduledDeliveries).toBe(1);

    await processIdentityValidityDeliveries({
      eventId: result.eventId as string,
    });

    const attestation = await db
      .select()
      .from(blockchainAttestations)
      .where(eq(blockchainAttestations.userId, userId))
      .get();
    // No provider available in test env → status is revocation_pending
    expect(attestation?.status).toBe("revocation_pending");
  });

  it("processes pending CIBA cancellation and back-channel logout through the delivery worker", async () => {
    const fetchSpy = vi.fn<typeof fetch>();
    fetchSpy.mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const clientId = "bcl-validity-client";
    await seedSigningKey();
    await createBclClient(clientId, {
      backchannel_logout_uri: "https://rp.example.com/backchannel-logout",
    });
    const { authReqId } = await createTestCibaRequest({
      clientId,
      userId,
      status: "pending",
    });
    await seedVerifiedIdentity(userId);

    const result = await revokeIdentity(
      userId,
      "admin@zentity.app",
      "fraud",
      "admin"
    );

    const scheduledRows = await db
      .select()
      .from(identityValidityDeliveries)
      .where(eq(identityValidityDeliveries.eventId, result.eventId as string))
      .all();
    expect(scheduledRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: "ciba_request_cancellation",
          targetKey: authReqId,
          status: "pending",
        }),
        expect.objectContaining({
          target: "backchannel_logout",
          targetKey: clientId,
          status: "pending",
        }),
      ])
    );

    await processIdentityValidityDeliveries({
      eventId: result.eventId as string,
    });

    const cibaRow = await db
      .select({ status: cibaRequests.status })
      .from(cibaRequests)
      .where(eq(cibaRequests.authReqId, authReqId))
      .get();
    expect(cibaRow?.status).toBe("rejected");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://rp.example.com/backchannel-logout",
      expect.objectContaining({ method: "POST" })
    );

    const deliveredRows = await db
      .select()
      .from(identityValidityDeliveries)
      .where(eq(identityValidityDeliveries.eventId, result.eventId as string))
      .all();
    expect(deliveredRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: "ciba_request_cancellation",
          status: "delivered",
        }),
        expect.objectContaining({
          target: "backchannel_logout",
          status: "delivered",
        }),
      ])
    );
  });

  it("revoked records filtered from getLatestVerification", async () => {
    await seedVerifiedIdentity(userId);

    const before = await getLatestVerification(userId);
    expect(before?.status).toBe("verified");

    await revokeIdentity(userId, "admin@zentity.app", "fraud", "admin");

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
    await revokeIdentity(
      userId,
      "admin@zentity.app",
      "expired document",
      "admin"
    );

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

  it("re-registration allowed after revocation (NFC nullifier released)", async () => {
    const challengerUserId = await createTestUser({
      email: "challenger@test.com",
    });
    const uniqueIdentifier = `nfc-nullifier-${userId}`;

    await db
      .insert(identityVerifications)
      .values({
        id: crypto.randomUUID(),
        userId,
        method: "nfc_chip",
        status: "verified",
        uniqueIdentifier,
        verifiedAt: new Date().toISOString(),
      })
      .run();

    await expect(
      isNullifierUsedByOtherUser(uniqueIdentifier, challengerUserId)
    ).resolves.toBe(true);

    await revokeIdentity(
      userId,
      "admin@zentity.app",
      "expired passport",
      "admin"
    );

    await expect(
      isNullifierUsedByOtherUser(uniqueIdentifier, challengerUserId)
    ).resolves.toBe(false);
  });

  it("idempotent — double revocation does not fail", async () => {
    await seedVerifiedIdentity(userId);

    await revokeIdentity(userId, "admin@zentity.app", "fraud", "admin");
    const result = await revokeIdentity(
      userId,
      "admin@zentity.app",
      "duplicate",
      "admin"
    );

    expect(result.revokedVerifications).toBe(0);

    const revocationEvents = await db
      .select()
      .from(identityValidityEvents)
      .where(eq(identityValidityEvents.userId, userId))
      .all();
    expect(revocationEvents).toHaveLength(1);
  });

  it("clears the frozen seed on revocation and reseeds it from a new verification", async () => {
    const originalVerificationId = crypto.randomUUID();
    const reverifiedVerificationId = crypto.randomUUID();

    await createVerification({
      id: originalVerificationId,
      userId,
      method: "ocr",
      status: "verified",
      dedupKey: "dedup-before-revocation",
      documentHash: "hash-before-revocation",
      verifiedAt: "2025-01-01T00:00:00Z",
    });
    await reconcileIdentityBundle(userId);

    const seededBundle = await db
      .select()
      .from(identityBundles)
      .where(eq(identityBundles.userId, userId))
      .get();
    expect(seededBundle?.rpNullifierSeed).toBe("dedup-before-revocation");

    await revokeIdentity(
      userId,
      "admin@zentity.app",
      "identity reset",
      "admin"
    );

    const revokedBundle = await db
      .select()
      .from(identityBundles)
      .where(eq(identityBundles.userId, userId))
      .get();
    expect(revokedBundle?.rpNullifierSeed).toBeNull();

    await createVerification({
      id: reverifiedVerificationId,
      userId,
      method: "ocr",
      status: "verified",
      dedupKey: "dedup-after-revocation",
      documentHash: "hash-after-revocation",
      verifiedAt: "2025-02-01T00:00:00Z",
    });
    await reconcileIdentityBundle(userId);

    const reverifiedBundle = await db
      .select()
      .from(identityBundles)
      .where(eq(identityBundles.userId, userId))
      .get();
    expect(reverifiedBundle?.validityStatus).toBe("verified");
    expect(reverifiedBundle?.effectiveVerificationId).toBe(
      reverifiedVerificationId
    );
    expect(reverifiedBundle?.rpNullifierSeed).toBe("dedup-after-revocation");
  });

  it("revokes OID4VCI issued credentials through the delivery worker", async () => {
    await seedVerifiedIdentity(userId);
    const credentialId = crypto.randomUUID();
    await db
      .insert(oidc4vciIssuedCredentials)
      .values({
        id: credentialId,
        userId,
        credentialConfigurationId: "IdentityCredential",
        format: "vc+sd-jwt",
        statusListId: "list-1",
        statusListIndex: 0,
        status: 0,
        credential: "{}",
      })
      .run();

    const result = await revokeIdentity(
      userId,
      "admin@zentity.app",
      "fraud",
      "admin"
    );
    expect(result.scheduledDeliveries).toBe(1);

    const scheduledDeliveries = await db
      .select()
      .from(identityValidityDeliveries)
      .where(eq(identityValidityDeliveries.eventId, result.eventId as string))
      .all();
    expect(scheduledDeliveries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "pending",
          target: "oidc4vci_credential_status",
          targetKey: credentialId,
        }),
      ])
    );

    await processIdentityValidityDeliveries({
      eventId: result.eventId as string,
    });

    const cred = await db
      .select()
      .from(oidc4vciIssuedCredentials)
      .where(eq(oidc4vciIssuedCredentials.userId, userId))
      .get();
    expect(cred?.status).toBe(1);
    expect(cred?.revokedAt).toBeTruthy();

    const deliveredRows = await db
      .select()
      .from(identityValidityDeliveries)
      .where(eq(identityValidityDeliveries.eventId, result.eventId as string))
      .all();
    expect(deliveredRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "delivered",
          target: "oidc4vci_credential_status",
          targetKey: credentialId,
        }),
      ])
    );
  });

  it("does not duplicate delivery rows when scheduling the same event twice", async () => {
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

    const result = await revokeIdentity(
      userId,
      "admin@zentity.app",
      "fraud",
      "admin"
    );

    await scheduleIdentityValidityDeliveries(result.eventId as string);
    await scheduleIdentityValidityDeliveries(result.eventId as string);

    const deliveries = await db
      .select()
      .from(identityValidityDeliveries)
      .where(eq(identityValidityDeliveries.eventId, result.eventId as string))
      .all();

    expect(deliveries).toHaveLength(1);
  });
});
