/**
 * Assurance Data Layer Integration Tests
 *
 * Tests tier computation with real database queries.
 * Covers the full tier progression path from Tier 0 to Tier 3.
 */
import crypto from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import {
  createBlockchainAttestation,
  updateBlockchainAttestationConfirmed,
} from "@/lib/db/queries/attestation";
import {
  insertEncryptedAttribute,
  insertSignedClaim,
  insertZkProofRecord,
} from "@/lib/db/queries/crypto";
import { createIdentityDocument } from "@/lib/db/queries/identity";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";

import {
  getAssuranceProfile,
  getTierProfile,
  getUnauthenticatedTierProfile,
} from "../data";

/**
 * Helper to create a verified identity document with all required fields
 */
async function createVerifiedDocument(
  docId: string,
  userId: string,
  options?: { documentType?: string; issuerCountry?: string }
) {
  await createIdentityDocument({
    id: docId,
    userId,
    documentType: options?.documentType ?? "passport",
    issuerCountry: options?.issuerCountry ?? "US",
    documentHash: crypto.randomBytes(32).toString("hex"),
    nameCommitment: crypto.randomBytes(32).toString("hex"),
    status: "verified",
    verifiedAt: new Date().toISOString(),
    confidenceScore: 0.95,
  });
}

describe("assurance data layer", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe("getUnauthenticatedTierProfile", () => {
    it("returns Tier 0 profile", () => {
      const profile = getUnauthenticatedTierProfile();

      expect(profile.tier).toBe(0);
      expect(profile.aal).toBe(0);
      expect(profile.label).toBe("Explore");
      expect(profile.nextTierRequirements).not.toBeNull();
    });
  });

  describe("getAssuranceProfile", () => {
    it("returns base profile for authenticated user with no verification", async () => {
      const userId = await createTestUser();
      const mockSession = createMockSession(userId, "opaque");

      const profile = await getAssuranceProfile(userId, mockSession);

      expect(profile.auth.level).toBe(1);
      expect(profile.auth.method).toBe("opaque");
      expect(profile.identity.level).toBe(0);
      expect(profile.identity.documentVerified).toBe(false);
      expect(profile.proof.level).toBe(0);
    });

    it("returns AAL2 for passkey authentication", async () => {
      const userId = await createTestUser();
      const mockSession = createMockSession(userId, "passkey");

      const profile = await getAssuranceProfile(userId, mockSession);

      expect(profile.auth.level).toBe(2);
      expect(profile.auth.method).toBe("passkey");
    });

    it("tracks document verification status", async () => {
      const userId = await createTestUser();
      const mockSession = createMockSession(userId, "opaque");

      const docId = crypto.randomUUID();
      await createVerifiedDocument(docId, userId);

      const profile = await getAssuranceProfile(userId, mockSession);

      expect(profile.identity.documentVerified).toBe(true);
    });

    it("tracks liveness from signed claims", async () => {
      const userId = await createTestUser();
      const mockSession = createMockSession(userId, "opaque");

      const docId = crypto.randomUUID();
      await createVerifiedDocument(docId, userId);

      await insertSignedClaim({
        id: crypto.randomUUID(),
        userId,
        documentId: docId,
        claimType: "liveness_score",
        claimPayload: JSON.stringify({ score: 0.95 }),
        signature: crypto.randomBytes(64).toString("hex"),
        issuedAt: new Date().toISOString(),
      });

      const profile = await getAssuranceProfile(userId, mockSession);

      expect(profile.identity.livenessPassed).toBe(true);
      // faceMatchPassed requires a ZK proof (face_match type), not a signed claim
      expect(profile.identity.faceMatchPassed).toBe(false);
    });

    it("tracks face match from ZK proof", async () => {
      const userId = await createTestUser();
      const mockSession = createMockSession(userId, "opaque");

      const docId = crypto.randomUUID();
      await createVerifiedDocument(docId, userId);

      await insertZkProofRecord({
        id: crypto.randomUUID(),
        userId,
        documentId: docId,
        proofType: "face_match",
        proofHash: crypto.randomBytes(32).toString("hex"),
        proofPayload: crypto.randomBytes(256).toString("hex"),
        verified: true,
      });

      const profile = await getAssuranceProfile(userId, mockSession);

      expect(profile.identity.faceMatchPassed).toBe(true);
    });

    it("tracks ZK proof completion", async () => {
      const userId = await createTestUser();
      const mockSession = createMockSession(userId, "opaque");

      const docId = crypto.randomUUID();
      await createVerifiedDocument(docId, userId);

      const proofTypes = [
        "age_verification",
        "doc_validity",
        "nationality_membership",
        "face_match",
      ];
      for (const proofType of proofTypes) {
        await insertZkProofRecord({
          id: crypto.randomUUID(),
          userId,
          documentId: docId,
          proofType,
          proofHash: crypto.randomBytes(32).toString("hex"),
          proofPayload: crypto.randomBytes(256).toString("hex"),
          verified: true,
        });
      }

      const profile = await getAssuranceProfile(userId, mockSession);

      expect(profile.proof.zkProofsComplete).toBe(true);
    });

    it("tracks FHE encryption completion", async () => {
      const userId = await createTestUser();
      const mockSession = createMockSession(userId, "opaque");

      const attributeTypes = [
        "birth_year_offset",
        "dob_days",
        "country_code",
        "compliance_level",
      ];
      for (const attributeType of attributeTypes) {
        await insertEncryptedAttribute({
          id: crypto.randomUUID(),
          userId,
          source: "fhe-service",
          attributeType,
          ciphertext: crypto.randomBytes(256),
        });
      }

      const profile = await getAssuranceProfile(userId, mockSession);

      expect(profile.proof.fheComplete).toBe(true);
    });

    it("tracks on-chain attestation", async () => {
      const userId = await createTestUser();
      const mockSession = createMockSession(userId, "opaque");

      const attestation = await createBlockchainAttestation({
        userId,
        walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
        networkId: "sepolia",
        chainId: 11_155_111,
      });
      await updateBlockchainAttestationConfirmed(attestation.id, 12_345);

      const profile = await getAssuranceProfile(userId, mockSession);

      expect(profile.proof.onChainAttested).toBe(true);
    });
  });

  describe("getTierProfile", () => {
    it("computes Tier 1 for authenticated user", async () => {
      const userId = await createTestUser();
      const mockSession = createMockSession(userId, "opaque");

      const profile = await getTierProfile(userId, mockSession);

      expect(profile.tier).toBe(1);
      expect(profile.label).toBe("Account");
    });

    it("computes Tier 2 for fully verified user", async () => {
      const userId = await createTestUser();
      const mockSession = createMockSession(userId, "opaque");

      const docId = crypto.randomUUID();
      await createVerifiedDocument(docId, userId);

      // Liveness comes from signed claims
      await insertSignedClaim({
        id: crypto.randomUUID(),
        userId,
        documentId: docId,
        claimType: "liveness_score",
        claimPayload: JSON.stringify({ score: 0.95 }),
        signature: crypto.randomBytes(64).toString("hex"),
        issuedAt: new Date().toISOString(),
      });

      // Face match requires a ZK proof
      await insertZkProofRecord({
        id: crypto.randomUUID(),
        userId,
        documentId: docId,
        proofType: "face_match",
        proofHash: crypto.randomBytes(32).toString("hex"),
        proofPayload: crypto.randomBytes(256).toString("hex"),
        verified: true,
      });

      const profile = await getTierProfile(userId, mockSession);

      expect(profile.tier).toBe(2);
      expect(profile.label).toBe("Verified");
    });

    it("computes Tier 3 for fully auditable user", async () => {
      const userId = await createTestUser();
      const mockSession = createMockSession(userId, "passkey");

      const docId = crypto.randomUUID();
      await createVerifiedDocument(docId, userId);

      // Signed claims
      for (const claimType of [
        "ocr_result",
        "liveness_score",
        "face_match_score",
      ]) {
        await insertSignedClaim({
          id: crypto.randomUUID(),
          userId,
          documentId: docId,
          claimType,
          claimPayload: JSON.stringify({ data: "test" }),
          signature: crypto.randomBytes(64).toString("hex"),
          issuedAt: new Date().toISOString(),
        });
      }

      // All ZK proofs
      for (const proofType of [
        "age_verification",
        "doc_validity",
        "nationality_membership",
        "face_match",
      ]) {
        await insertZkProofRecord({
          id: crypto.randomUUID(),
          userId,
          documentId: docId,
          proofType,
          proofHash: crypto.randomBytes(32).toString("hex"),
          proofPayload: crypto.randomBytes(256).toString("hex"),
          verified: true,
        });
      }

      // All FHE attributes
      for (const attributeType of [
        "birth_year_offset",
        "dob_days",
        "country_code",
        "compliance_level",
      ]) {
        await insertEncryptedAttribute({
          id: crypto.randomUUID(),
          userId,
          source: "fhe-service",
          attributeType,
          ciphertext: crypto.randomBytes(256),
        });
      }

      const profile = await getTierProfile(userId, mockSession);

      expect(profile.tier).toBe(3);
      expect(profile.label).toBe("Auditable");
      expect(profile.aal).toBe(2);
      expect(profile.nextTierRequirements).toBeNull();
    });

    it("includes correct next requirements for Tier 1", async () => {
      const userId = await createTestUser();
      const mockSession = createMockSession(userId, "opaque");

      const profile = await getTierProfile(userId, mockSession);

      expect(profile.tier).toBe(1);
      expect(profile.nextTierRequirements).toHaveLength(3);
      expect(profile.nextTierRequirements?.map((r) => r.id)).toEqual(
        expect.arrayContaining(["document", "liveness", "face_match"])
      );
    });
  });
});

/**
 * Create a mock session object for testing
 */
function createMockSession(userId: string, loginMethod: string) {
  const now = new Date();
  return {
    user: {
      id: userId,
      name: "Test User",
      email: `test-${userId}@example.com`,
      emailVerified: true,
      isAnonymous: false,
      twoFactorEnabled: loginMethod === "passkey",
      createdAt: now,
      updatedAt: now,
    },
    session: {
      id: crypto.randomUUID(),
      userId,
      lastLoginMethod: loginMethod,
      expiresAt: new Date(Date.now() + 86_400_000),
      createdAt: now,
      updatedAt: now,
      token: crypto.randomBytes(32).toString("hex"),
    },
  } as Parameters<typeof getAssuranceProfile>[1];
}
